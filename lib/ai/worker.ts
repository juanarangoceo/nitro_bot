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
import { runAssistant, type Content, type GeminiPart } from "./gemini";
import {
  sendText,
  markAsRead,
  downloadMedia,
  type WaCreds,
  type WaInboundMessage,
  type WaValue,
  type DownloadedMedia,
} from "../whatsapp/meta";
import type { Tenant, TenantSecrets } from "../tenant";

const DEBOUNCE_MS = 8_000;
const MAX_HISTORY = 24;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Normaliza el teléfono a E.164 con '+'. Meta entrega los dígitos sin el '+'.
function toE164(from: string): string {
  return from.startsWith("+") ? from : `+${from}`;
}

type InboundShape = {
  msgType: "text" | "audio" | "image" | "other";
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
    default:
      return { msgType: "other", content: "[mensaje no soportado]", mediaId: null };
  }
}

// Convierte el historial de la conversación en `contents` para Gemini.
// Para el mensaje actual, si hay media descargada, se adjunta inline (multimodal).
function buildContents(
  rows: { id: string; sender: string; content: string | null }[],
  currentMessageId: string,
  media: DownloadedMedia | null
): Content[] {
  return rows.map((r) => {
    const role: Content["role"] = r.sender === "customer" ? "user" : "model";
    if (r.id === currentMessageId && media) {
      const parts: GeminiPart[] = [
        { inlineData: { mimeType: media.mimeType, data: media.base64 } },
      ];
      if (r.content) parts.push({ text: r.content });
      return { role, parts };
    }
    return { role, parts: [{ text: r.content ?? "" }] };
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

  // 1) Conversación: obtener-o-crear sin pisar el estado existente (no des-escalar).
  let { data: conv } = await supabase
    .from("conversations")
    .select("id, status")
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
          last_customer_message_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,customer_phone", ignoreDuplicates: false }
      )
      .select("id, status")
      .single();
    if (error || !inserted) {
      console.error(`[worker] no se pudo crear conversación:`, error);
      return;
    }
    conv = inserted;
  } else {
    await supabase
      .from("conversations")
      .update({ last_customer_message_at: new Date().toISOString() })
      .eq("id", conv.id);
  }
  const conversationId = conv.id;

  // Mantén el CRM mínimo al día (nombre del contacto). Best-effort.
  if (contactName) {
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
  const { data: counter, error: counterError } = await supabase
    .rpc("increment_message_counter", { p_tenant_id: tenant.id })
    .maybeSingle<{ over_limit: boolean; at_80_percent: boolean }>();
  if (counterError) {
    console.error(`[worker] increment_message_counter falló:`, counterError.message);
  }
  if (counter?.over_limit) {
    console.warn(`[worker] tenant ${tenant.id} superó el límite de mensajes; no respondo.`);
    return;
  }
  if (counter?.at_80_percent) {
    console.warn(`[worker] tenant ${tenant.id} al 80% del límite mensual.`);
  }

  // 6) Construir historial → correr el asesor.
  const { data: history } = await supabase
    .from("messages")
    .select("id, sender, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(MAX_HISTORY);

  const contents = buildContents(history ?? [], currentMessageId, media);

  const shopify =
    tenant.shopify_domain && secrets.shopify_access_token
      ? { domain: tenant.shopify_domain, accessToken: secrets.shopify_access_token }
      : undefined;

  const result = await runAssistant({ tenant, conversationId, shopify, contents });
  const reply = result.text?.trim();
  if (!reply) return; // p.ej. solo se escaló; nada que enviar.

  // 7) Enviar por WhatsApp y persistir la respuesta del bot (idempotente por su wamid).
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
