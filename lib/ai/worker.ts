// Worker de procesamiento de mensajes entrantes de WhatsApp.
// Corre FUERA del request (vía lib/queue → after()), nunca bloquea el 200 OK.
//
// Garantías que implementa (reglas no negociables):
//  - Idempotencia por wa_message_id: Meta reenvía eventos; cada mensaje se procesa
//    una sola vez (insert ON CONFLICT DO NOTHING → seguimos solo si insertó).
//  - Debounce ~8s: coalesce ráfagas. Cada mensaje agenda un worker; tras el
//    debounce, solo el ÚLTIMO mensaje de la conversación responde; los demás abortan.
//  - Gate por estado: si la conversación está en requires_human/human_active/closed,
//    el bot NO responde (un humano la tiene).
//  - Contador de consumo atómico: increment_message_counter + corte al pasar el límite.
//  - Multimodal: notas de voz e imágenes se descargan y se pasan a Gemini inline.
//  - Precios/totales jamás los fija la IA (eso vive en lib/ai/tools.ts).

import { createAdminClient } from "../supabase/admin";
import { runAssistant, type AssistantResult, type Content, type GeminiPart } from "./gemini";
import { escalateToHuman } from "./escalation";
import { logEvent, summarizeToolTrace, type EventKind } from "../ops/events";
import { sendTelegramAlert, escTelegram } from "../notify/telegram";
import {
  sendText,
  sendAudio,
  uploadMedia,
  markAsRead,
  downloadMedia,
  type WaCreds,
  type WaInboundMessage,
  type WaValue,
  type DownloadedMedia,
} from "../whatsapp/meta";
import { synthesizeSpeech } from "./tts";
import { env } from "../env";
import { uploadWaMedia, downloadWaMedia } from "../storage";
import type { Tenant, TenantSecrets } from "../tenant";

const DEBOUNCE_MS = 8_000;
// Ventana de historial a Gemini. 20 cubre el p90 de conversaciones reales (19
// mensajes) y el cierre de venta típico; el producto_id de crear_orden no
// depende de la ventana (el modelo re-busca en el mismo turno del cierre).
const MAX_HISTORY = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Normaliza el teléfono a E.164 con '+'. Meta entrega los dígitos sin el '+'.
function toE164(from: string): string {
  return from.startsWith("+") ? from : `+${from}`;
}

type InboundShape = {
  msgType: "text" | "audio" | "image" | "video" | "other";
  content: string; // texto o placeholder (lo que se guarda en messages.content)
  mediaId: string | null; // id de media en Meta, si aplica
};

// Mapea el mensaje crudo de Meta a lo que persistimos + qué media descargar.
function shapeInbound(message: WaInboundMessage): InboundShape {
  switch (message.type) {
    case "text":
      return { msgType: "text", content: message.text?.body ?? "", mediaId: null };
    case "audio":
      return { msgType: "audio", content: "[nota de voz]", mediaId: message.audio?.id ?? null };
    case "image":
      return {
        msgType: "image",
        content: message.image?.caption ?? "[imagen]",
        mediaId: message.image?.id ?? null,
      };
    case "video": {
      // El video se descarga y persiste (el agente lo ve en el panel), pero
      // JAMÁS va inline a Gemini ni genera un turno de IA: el worker responde
      // enlatado y escala (ver el short-circuit en processInboundMessage).
      const caption = message.video?.caption?.trim();
      return {
        msgType: "video",
        content: caption ? `[video] ${caption}` : "[video]",
        mediaId: message.video?.id ?? null,
      };
    }
    default:
      return { msgType: "other", content: "[mensaje no soportado]", mediaId: null };
  }
}

type HistoryRow = {
  id: string;
  sender: string;
  msg_type: string;
  content: string | null;
  media_path: string | null;
  media_mime: string | null;
};

type InlineMedia = { mimeType: string; base64: string };

// Convierte el historial de la conversación en `contents` para Gemini.
// Las filas presentes en `mediaById` llevan su media inline (multimodal).
function buildContents(rows: HistoryRow[], mediaById: Map<string, InlineMedia>): Content[] {
  return rows.map((r) => {
    const role: Content["role"] = r.sender === "customer" ? "user" : "model";
    const inline = mediaById.get(r.id);
    if (inline) {
      const parts: GeminiPart[] = [
        { inlineData: { mimeType: inline.mimeType, data: inline.base64 } },
      ];
      if (r.content) parts.push({ text: r.content });
      return { role, parts };
    }
    return { role, parts: [{ text: r.content ?? "" }] };
  });
}

// Media a adjuntar inline en este turno. No solo la del mensaje actual: con el
// debounce "último gana", una foto seguida de un texto hacía que la foto llegara
// a Gemini como "[imagen]" sin bytes. Se adjunta la media de TODOS los mensajes
// del cliente posteriores a la última respuesta del bot (el turno pendiente),
// con tope de piezas y de tamaño; la del mensaje actual ya está en memoria.
const MAX_TURN_MEDIA = 3;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

async function collectTurnMedia(
  history: HistoryRow[],
  currentMessageId: string,
  currentMedia: DownloadedMedia | null
): Promise<Map<string, InlineMedia>> {
  const mediaById = new Map<string, InlineMedia>();
  let lastBotIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].sender !== "customer") {
      lastBotIdx = i;
      break;
    }
  }
  // Los videos jamás van inline a Gemini (~300 tokens/segundo): en el historial
  // quedan solo como texto "[video]".
  const isVideo = (mime: string | null | undefined) => (mime ?? "").startsWith("video/");
  const current = currentMedia && !isVideo(currentMedia.mimeType) ? currentMedia : null;
  const pending = history
    .slice(lastBotIdx + 1)
    .filter((r) => r.media_path && !isVideo(r.media_mime));
  for (const row of pending.slice(-MAX_TURN_MEDIA)) {
    if (row.id === currentMessageId && current) {
      mediaById.set(row.id, { mimeType: current.mimeType, base64: current.base64 });
      continue;
    }
    const bytes = await downloadWaMedia(row.media_path!);
    if (!bytes || bytes.length > MAX_MEDIA_BYTES) continue;
    mediaById.set(row.id, {
      mimeType: row.media_mime ?? "application/octet-stream",
      base64: bytes.toString("base64"),
    });
  }
  // El mensaje actual puede no tener media_path (upload a Storage fallido) pero
  // sí media en memoria: nunca se pierde.
  if (current && !mediaById.has(currentMessageId)) {
    mediaById.set(currentMessageId, {
      mimeType: current.mimeType,
      base64: current.base64,
    });
  }
  return mediaById;
}

// Mensaje cálido y resolutivo cuando el asesor queda trabado (NUNCA el
// "¿me lo repites?" en bucle): se escala y se le dice al cliente qué sigue.
const TECH_FAILURE_REPLY =
  "Dame un momento, voy a conectarte con una persona del equipo para ayudarte con esto. 🙂";

// Video entrante: el bot no lo interpreta (sería carísimo en Gemini); se
// persiste para que el agente lo VEA en el panel y se escala bien etiquetado.
const VIDEO_RECEIVED_REPLY =
  "¡Recibí tu video! 🙌 Se lo paso a una persona del equipo para que lo revise contigo.";

// Escalado con respuesta enlatada (sin llamar a la IA): ticket + aviso al
// cliente + traza en event_log. Cada paso es best-effort: el fallo de uno no
// impide los demás.
async function escalateWithCannedReply(params: {
  tenant: Tenant;
  conversationId: string;
  wa: WaCreds;
  phone: string;
  reply: string;
  reason: string;
  kind: EventKind;
  severity: "info" | "warning" | "error";
  detail: unknown;
}): Promise<void> {
  const { tenant, conversationId, wa, phone, reply, reason, kind, severity, detail } = params;
  const supabase = createAdminClient();

  try {
    await escalateToHuman({
      tenantId: tenant.id,
      conversationId,
      reason,
    });
  } catch (e) {
    console.error(`[worker] escalado (${reason}) no se pudo registrar:`, e);
  }

  try {
    const outboundId = await sendText(wa, phone, reply);
    await supabase.from("messages").insert({
      tenant_id: tenant.id,
      conversation_id: conversationId,
      wa_message_id: outboundId,
      sender: "bot",
      msg_type: "text",
      content: reply,
    });
  } catch (e) {
    console.error("[worker] no se pudo avisar al cliente del escalado:", e);
  }

  await logEvent({ kind, severity, tenantId: tenant.id, conversationId, detail });
}

// Escalado automático por fallo técnico (runAssistant lanzó o agotó el loop).
async function escalateTechnicalFailure(params: {
  tenant: Tenant;
  conversationId: string;
  wa: WaCreds;
  phone: string;
  detail: unknown;
}): Promise<void> {
  await escalateWithCannedReply({
    ...params,
    reply: TECH_FAILURE_REPLY,
    reason: "fallo_tecnico",
    kind: "escalation_auto",
    severity: "error",
  });
}

export async function processInboundMessage(params: {
  tenant: Tenant;
  secrets: TenantSecrets;
  value: WaValue;
  message: WaInboundMessage;
}): Promise<void> {
  const { tenant, secrets, value, message } = params;
  const supabase = createAdminClient();

  // Credenciales de WhatsApp del tenant. Sin ellas no podemos responder.
  if (!tenant.wa_phone_number_id || !secrets.wa_access_token) {
    console.error(`[worker] tenant ${tenant.id} sin credenciales WhatsApp; ignoro.`);
    return;
  }
  const wa: WaCreds = {
    phoneNumberId: tenant.wa_phone_number_id,
    accessToken: secrets.wa_access_token,
  };

  const phone = toE164(message.from);
  const contactName = value.contacts?.[0]?.profile?.name ?? null;

  // ¿Número de prueba del tenant? Su conversación se marca is_test: no
  // descuenta del contador y el dashboard la muestra como «Prueba». Si el
  // número sale de la lista en /admin, la conversación vuelve a ser normal.
  const isTest = Array.isArray(tenant.test_phones) && tenant.test_phones.includes(phone);

  // 1) Conversación: obtener-o-crear sin pisar el estado existente (no des-escalar).
  //    Excepción: una conversación CERRADA se reactiva a bot_active cuando el
  //    cliente vuelve a escribir. closed_at se conserva como corte de contexto:
  //    el historial que ve la IA excluye lo anterior al cierre (el dato
  //    histórico no se borra; métricas y CRM intactos).
  let { data: conv } = await supabase
    .from("conversations")
    .select("id, status, closed_at, is_test")
    .eq("tenant_id", tenant.id)
    .eq("customer_phone", phone)
    .maybeSingle();

  if (!conv) {
    const { data: inserted, error } = await supabase
      .from("conversations")
      .upsert(
        {
          tenant_id: tenant.id,
          customer_phone: phone,
          status: "bot_active",
          is_test: isTest,
          last_customer_message_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,customer_phone", ignoreDuplicates: false }
      )
      .select("id, status, closed_at, is_test")
      .single();
    if (error || !inserted) {
      console.error(`[worker] no se pudo crear conversación:`, error);
      return;
    }
    conv = inserted;
  } else {
    const update: Record<string, unknown> = {
      last_customer_message_at: new Date().toISOString(),
      reminder_count: 0, // el cliente escribió: nuevo episodio de silencio
    };
    if (conv.status === "closed") {
      update.status = "bot_active"; // reactivación; closed_at queda como corte
    }
    if ((conv.is_test ?? false) !== isTest) {
      update.is_test = isTest; // el número entró o salió de la lista de prueba
    }
    await supabase.from("conversations").update(update).eq("id", conv.id);
  }
  const conversationId = conv.id;
  const historyCutoff = conv.closed_at; // null si nunca se cerró

  // Mantén el CRM mínimo al día (nombre del contacto). Best-effort. Los
  // números de prueba no entran al CRM del cliente.
  if (contactName && !isTest) {
    await supabase
      .from("customers")
      .upsert(
        { tenant_id: tenant.id, phone, name: contactName },
        { onConflict: "tenant_id,phone", ignoreDuplicates: true }
      );
  }

  // 2) Idempotencia: insertar el mensaje entrante. Si ya existía (reenvío de Meta),
  //    upsert con ignoreDuplicates no devuelve fila → abortamos.
  const shaped = shapeInbound(message);
  const { data: insertedMsg } = await supabase
    .from("messages")
    .upsert(
      {
        tenant_id: tenant.id,
        conversation_id: conversationId,
        wa_message_id: message.id,
        sender: "customer",
        msg_type: shaped.msgType,
        content: shaped.content,
      },
      { onConflict: "tenant_id,wa_message_id", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();

  if (!insertedMsg) {
    // Evento duplicado o carrera: otra invocación ya tomó este mensaje.
    return;
  }
  const currentMessageId = insertedMsg.id;

  await markAsRead(wa, message.id);

  // Descarga de media (audio/imagen) para el turno multimodal actual.
  const media = shaped.mediaId ? await downloadMedia(wa, shaped.mediaId) : null;

  // Persistir la media entrante en Storage para poder mostrarla/oírla luego en
  // el panel de conversaciones (best-effort: no bloquea la respuesta del bot).
  if (media) {
    try {
      const path = await uploadWaMedia({
        tenantId: tenant.id,
        conversationId,
        messageId: currentMessageId,
        bytes: Buffer.from(media.base64, "base64"),
        mimeType: media.mimeType,
      });
      await supabase
        .from("messages")
        .update({ media_path: path, media_mime: media.mimeType })
        .eq("id", currentMessageId);
    } catch (e) {
      console.error("[worker] no se pudo persistir media entrante:", e);
    }
  }

  // 3) Debounce: esperar y coalescer. Si tras la espera llegó un mensaje más
  //    nuevo del cliente, esa invocación se encargará; esta aborta.
  await sleep(DEBOUNCE_MS);
  const { data: latest } = await supabase
    .from("messages")
    .select("wa_message_id")
    .eq("conversation_id", conversationId)
    .eq("sender", "customer")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest?.wa_message_id !== message.id) {
    return; // hay un mensaje posterior; cedemos el turno.
  }

  // 4) Gate por estado (releído: pudo cambiar durante el debounce).
  const { data: fresh } = await supabase
    .from("conversations")
    .select("status")
    .eq("id", conversationId)
    .maybeSingle();
  if (fresh?.status !== "bot_active") {
    return; // un humano tiene la conversación, o está cerrada.
  }

  // 5) Contador de consumo atómico + corte al pasar el límite.
  //    Conversaciones de prueba: NO descuentan (ni alertan créditos) y el bot
  //    responde aunque el tenant esté al límite — para eso son las pruebas.
  const { data: counter, error: counterError } = isTest
    ? { data: null, error: null }
    : await supabase
        .rpc("increment_message_counter", { p_tenant_id: tenant.id })
        .maybeSingle<{
          current_count: number;
          message_limit: number;
          over_limit: boolean;
          at_80_percent: boolean;
        }>();
  if (counterError) {
    console.error(`[worker] increment_message_counter falló:`, counterError.message);
  }
  // Alertas al Telegram del dueño por CRUCE exacto (una vez por periodo, sin
  // dedup extra: el contador solo pasa por cada valor una vez). El umbral del
  // 80% replica el `(v_limit*0.8)::int` de la función SQL (redondeo).
  if (counter) {
    const limit = counter.message_limit;
    if (counter.current_count === limit + 1) {
      await sendTelegramAlert(
        `🔴 <b>${escTelegram(tenant.name)}</b> llegó a su límite (${limit.toLocaleString(
          "es-CO"
        )} mensajes): su bot DEJÓ de responder. Cobrar/ampliar ya.`
      );
    } else if (counter.current_count === Math.round(limit * 0.8)) {
      await sendTelegramAlert(
        `🟠 <b>${escTelegram(tenant.name)}</b> cruzó el 80% de su plan (${counter.current_count.toLocaleString(
          "es-CO"
        )}/${limit.toLocaleString("es-CO")} mensajes) — momento de ofrecer la recarga.`
      );
    }
  }
  if (counter?.over_limit) {
    console.warn(`[worker] tenant ${tenant.id} superó el límite de mensajes; no respondo.`);
    return;
  }
  if (counter?.at_80_percent) {
    console.warn(`[worker] tenant ${tenant.id} al 80% del límite mensual.`);
  }

  // 6) Construir historial → correr el asesor.
  // Tomamos los MAX_HISTORY mensajes MÁS RECIENTES (no los más viejos) y los
  // devolvemos a orden cronológico. Con `ascending: true` + limit, al pasar de
  // MAX_HISTORY mensajes la ventana se quedaba clavada en los primeros: el turno
  // actual del cliente nunca entraba y el contexto terminaba en un turno del
  // modelo → Gemini respondía vacío y el bot dejaba de contestar.
  // Si la conversación se cerró en algún momento, el contexto arranca limpio:
  // solo mensajes posteriores al último cierre (closed_at).
  let historyQuery = supabase
    .from("messages")
    .select("id, sender, msg_type, content, media_path, media_mime")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY);
  if (historyCutoff) historyQuery = historyQuery.gt("created_at", historyCutoff);
  const { data: recent } = await historyQuery;
  const history: HistoryRow[] = (recent ?? []).reverse();

  // El contexto DEBE terminar en turno del cliente (regla Gemini 3.x: si
  // termina en turno del modelo, Gemini "continúa" ese turno en vez de
  // responder — llegó a completar una ficha de producto con precio inventado
  // e inventar el siguiente mensaje del cliente). Puede pasar cuando un worker
  // paralelo (mensajes separados por ~8-9s) inserta un mensaje del bot (p.ej.
  // la foto de enviar_imagen_producto) después del mensaje que dispara este
  // turno: se recorta del final todo lo que no sea del cliente.
  while (history.length && history[history.length - 1].sender !== "customer") {
    history.pop();
  }
  if (history.length === 0) {
    console.warn(
      `[worker] historial sin turno de cliente al final (conv=${conversationId}); no llamo a Gemini.`
    );
    return;
  }

  // Video en el turno pendiente → respuesta enlatada + ticket, SIN llamar a
  // Gemini (cero tokens). El video ya quedó persistido en Storage: el agente lo
  // ve y lo reproduce en el panel de Tickets/Conversaciones.
  let lastBotIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].sender !== "customer") {
      lastBotIdx = i;
      break;
    }
  }
  const pendingTurn = history.slice(lastBotIdx + 1);
  if (shaped.msgType === "video" || pendingTurn.some((r) => r.msg_type === "video")) {
    await escalateWithCannedReply({
      tenant,
      conversationId,
      wa,
      phone,
      reply: VIDEO_RECEIVED_REPLY,
      reason: "video_recibido",
      kind: "video_received",
      severity: "info",
      detail: { message_id: currentMessageId, mime: media?.mimeType ?? null },
    });
    return;
  }

  const mediaById = await collectTurnMedia(history, currentMessageId, media);
  const contents = buildContents(history, mediaById);

  const shopify =
    tenant.shopify_domain && secrets.shopify_access_token
      ? { domain: tenant.shopify_domain, accessToken: secrets.shopify_access_token }
      : undefined;

  // Escalado automático por fallo técnico (Feature A de la spec de operación):
  // si runAssistant lanza o agota el loop de herramientas, el cliente NO queda
  // en un callejón sin salida ("¿me lo repites?" en bucle): se escala a humano
  // con ticket, se le avisa con un mensaje resolutivo y queda la traza en
  // event_log para diagnóstico.
  // Respuesta de voz (premium): solo si el tenant la tiene activa, el mensaje
  // ganador del debounce fue una nota de voz y hay TTS configurado. Si el
  // cliente vuelve a escribir texto, este flag queda en false y todo sigue
  // como siempre con texto.
  const voiceTurn =
    tenant.voice_replies_enabled === true &&
    shaped.msgType === "audio" &&
    !!env.MISTRAL_API_KEY &&
    !!(tenant.voice_id ?? env.MISTRAL_VOICE_ID);

  const VOICE_TURN_INSTRUCTION =
    "NOTA DEL TURNO: el cliente envió una nota de voz y tu respuesta se convertirá en AUDIO con tu voz. " +
    "Responde en MÁXIMO 2 frases (~45 palabras), lenguaje hablado natural, directo al punto, con tu mismo tono. " +
    "NO repitas saludos, ni información que ya diste en mensajes anteriores, ni lo que el cliente acaba de decir: di solo lo NUEVO. " +
    "Si hay varios productos, menciona máximo 2. " +
    "Nada de markdown, emojis, listas, viñetas ni URLs: solo texto corrido que suene bien dicho en voz alta.";

  let result: AssistantResult;
  try {
    result = await runAssistant({
      tenant,
      conversationId,
      shopify,
      wa,
      customerPhone: phone,
      extraSystem: voiceTurn ? VOICE_TURN_INSTRUCTION : undefined,
      contents,
    });
  } catch (e) {
    console.error(`[worker] runAssistant lanzó (tenant=${tenant.id} conv=${conversationId}):`, e);
    await logEvent({
      kind: "assistant_error",
      severity: "error",
      tenantId: tenant.id,
      conversationId,
      detail: { message: (e as Error).message },
    });
    await escalateTechnicalFailure({ tenant, conversationId, wa, phone, detail: { message: (e as Error).message } });
    return;
  }

  // Consumo de tokens del turno (todas las rondas), para atribuir el gasto de
  // Gemini desde /admin/health. Best-effort, antes del corte por exhausted
  // para que los turnos agotados (los más caros) también queden medidos.
  if (result.usage?.calls) {
    await logEvent({
      kind: "gemini_usage",
      severity: "info",
      tenantId: tenant.id,
      conversationId,
      detail: { ...result.usage, source: isTest ? "whatsapp_test" : "whatsapp", voice: voiceTurn },
    });
  }

  if (result.exhausted) {
    await escalateTechnicalFailure({
      tenant,
      conversationId,
      wa,
      phone,
      detail: { tool_trace: summarizeToolTrace(result.toolTrace) },
    });
    return;
  }

  // Observabilidad (Feature B): persistir la traza de herramientas del turno.
  // Best-effort y solo si hubo herramientas (trazas vacías no se insertan).
  if (result.toolTrace.length > 0) {
    await logEvent({
      kind: "tool_trace",
      severity: "info",
      tenantId: tenant.id,
      conversationId,
      detail: { tools: summarizeToolTrace(result.toolTrace) },
    });
  }

  const reply = result.text?.trim();
  if (!reply) {
    // Sin texto: puede ser legítimo (solo se escaló o se envió una imagen) o el
    // bug de respuesta vacía de Gemini. Logueamos para que NO sea invisible en
    // Vercel (ver nota de Gemini 3.x en CLAUDE.md).
    console.warn(
      `[worker] runAssistant sin texto (tenant=${tenant.id} conv=${conversationId} tools=${result.toolTrace
        .map((t) => t.name)
        .join(",")})`
    );
    return;
  }

  // 7) "Último gana" también al ENVIAR: si mientras Gemini generaba llegó un
  //    mensaje más nuevo del cliente (p. ej. dos mensajes separados por ~8,5s
  //    que burlan el debounce → dos workers solapados), esta respuesta ya está
  //    desactualizada: se descarta y responde el worker del mensaje nuevo con
  //    el historial completo. Sin esto la carrera producía DOS respuestas del
  //    bot (y hasta dos órdenes) en la misma conversación.
  const { data: latestNow } = await supabase
    .from("messages")
    .select("wa_message_id")
    .eq("conversation_id", conversationId)
    .eq("sender", "customer")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestNow?.wa_message_id !== message.id) {
    await logEvent({
      kind: "stale_reply_dropped",
      severity: "info",
      tenantId: tenant.id,
      conversationId,
      detail: { message_id: currentMessageId },
    });
    return;
  }

  // 8) Enviar por WhatsApp y persistir la respuesta del bot (idempotente por su wamid).
  //    Turno de voz: se sintetiza el texto de Gemini con Mistral y se envía como
  //    nota de voz. Cualquier fallo (TTS, upload o envío) cae a texto: el
  //    cliente SIEMPRE recibe respuesta. El texto se guarda como content aunque
  //    la respuesta sea audio: el historial de Gemini y el dashboard lo ven.
  if (voiceTurn) {
    const speech = await synthesizeSpeech({
      text: reply,
      voiceId: tenant.voice_id,
      tenantId: tenant.id,
      conversationId,
    });
    if (speech) {
      try {
        const waMediaId = await uploadMedia(wa, speech.bytes, speech.mimeType, "respuesta.ogg");
        const outboundId = await sendAudio(wa, phone, { id: waMediaId });

        // Persistir también en Storage para oírla luego en el panel (best-effort).
        let mediaPath: string | null = null;
        try {
          mediaPath = await uploadWaMedia({
            tenantId: tenant.id,
            conversationId,
            messageId: crypto.randomUUID(),
            bytes: speech.bytes,
            mimeType: speech.mimeType,
          });
        } catch (e) {
          console.error("[worker] no se pudo persistir la nota de voz saliente:", e);
        }

        await supabase.from("messages").insert({
          tenant_id: tenant.id,
          conversation_id: conversationId,
          wa_message_id: outboundId,
          sender: "bot",
          msg_type: "audio",
          content: reply,
          media_path: mediaPath,
          media_mime: speech.mimeType,
        });
        return;
      } catch (e) {
        // uploadMedia/sendAudio fallaron: traza y fallback a texto.
        console.error("[worker] envío de nota de voz falló; respondo texto:", e);
        await logEvent({
          kind: "tts_failure",
          severity: "warning",
          tenantId: tenant.id,
          conversationId,
          detail: { stage: "whatsapp_send", error: (e as Error).message },
        });
      }
    }
  }

  const outboundId = await sendText(wa, phone, reply);
  await supabase.from("messages").insert({
    tenant_id: tenant.id,
    conversation_id: conversationId,
    wa_message_id: outboundId,
    sender: "bot",
    msg_type: "text",
    content: reply,
  });
}
