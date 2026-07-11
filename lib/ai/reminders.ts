// Recordatorios automáticos (follow-up) a conversaciones que quedaron a medias.
// Máximo 2 por episodio de silencio, SIEMPRE dentro de la ventana de 24h de
// WhatsApp (mensajes libres): fase 1 a las ~4h (retoma la conversación con una
// pregunta), fase 2 a las ~22h (despedida sin presión, la última). El worker
// vuelve reminder_count a 0 cuando el cliente escribe (nuevo episodio).
//
// Nunca se recuerda si: la conversación no está bot_active, es de prueba, el
// último mensaje no es del bot, ya hay una orden creada, el tenant está
// inactivo/sin recordatorios/al límite de mensajes. Best-effort por
// conversación: un fallo no detiene el barrido.

import { createAdminClient } from "../supabase/admin";
import { getTenantByPhoneNumberId, type Tenant } from "../tenant";
import { sendText, type WaCreds } from "../whatsapp/meta";
import { logEvent } from "../ops/events";
import { emptyUsage, accumulateUsage, THINKING_LEVEL } from "./gemini";
import { env } from "../env";

const PHASE1_MIN_HOURS = 4;
const PHASE2_MIN_HOURS = 20;
const MAX_WINDOW_HOURS = 23; // margen antes del cierre de 24h de Meta
const HISTORY_LIMIT = 20;

const PHASE1_FALLBACK =
  "¡Hola! Quedamos a mitad de conversación 🙂 ¿Te ayudo con algo más para decidirte?";
const PHASE2_FALLBACK =
  "No quiero llenarte de mensajes 🙂 Cuando quieras retomar la conversación, me escribes por aquí. ¡Feliz día!";

const PHASE1_INSTRUCTION = `[INSTRUCCIÓN DEL SISTEMA — no es un mensaje del cliente]
El cliente lleva varias horas sin responder. Genera SOLO el texto de UN mensaje
corto de seguimiento por WhatsApp (1 a 3 frases, español de Colombia, cálido,
sin sonar insistente): retoma exactamente donde quedó la conversación (el
producto o duda pendiente) y termina con UNA pregunta concreta. No saludes como
si fuera la primera vez. No inventes precios ni productos que no estén en la
conversación. Responde únicamente con el texto del mensaje.`;

const PHASE2_INSTRUCTION = `[INSTRUCCIÓN DEL SISTEMA — no es un mensaje del cliente]
El cliente no respondió en casi un día. Genera SOLO el texto del ÚLTIMO mensaje
de seguimiento por WhatsApp (2 a 3 frases, español de Colombia): despedida
elegante SIN presión. Si en la conversación quedó un producto concreto, deja un
resumen útil en una línea (nombre y precio SOLO si aparecen en la conversación).
Cierra dejando la puerta abierta ("cuando quieras retomar, me escribes por
aquí") y desea un buen día. No inventes datos. Responde únicamente con el texto
del mensaje.`;

type ConvRow = {
  id: string;
  customer_phone: string;
  last_customer_message_at: string;
  reminder_count: number;
  last_reminder_at: string | null;
};

// Genera el texto del recordatorio con Gemini (sin herramientas) a partir del
// historial. La instrucción va como turno `user` final (regla Gemini 3.x: el
// contents debe terminar en turno del cliente). Fallback a texto fijo.
async function generateReminderText(
  tenant: Tenant,
  conversationId: string,
  phase: 1 | 2
): Promise<string> {
  const fallback = phase === 1 ? PHASE1_FALLBACK : PHASE2_FALLBACK;
  try {
    const supabase = createAdminClient();
    const { data: rows } = await supabase
      .from("messages")
      .select("sender, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    const history = (rows ?? []).reverse().filter((m) => m.content);
    if (history.length === 0) return fallback;

    const contents = [
      ...history.map((m) => ({
        role: m.sender === "customer" ? ("user" as const) : ("model" as const),
        parts: [{ text: String(m.content) }],
      })),
      {
        role: "user" as const,
        parts: [{ text: phase === 1 ? PHASE1_INSTRUCTION : PHASE2_INSTRUCTION }],
      },
    ];

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${tenant.ai_model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: `Eres el asesor de ventas por WhatsApp de la tienda ${tenant.name}. Generas mensajes de seguimiento breves y cálidos en español de Colombia.`,
              },
            ],
          },
          contents,
          generationConfig: { thinkingConfig: { thinkingLevel: THINKING_LEVEL } },
        }),
      }
    );
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
    // Medición de tokens (best-effort, misma traza que el worker).
    const usage = emptyUsage();
    accumulateUsage(usage, json);
    if (usage.calls) {
      await logEvent({
        kind: "gemini_usage",
        severity: "info",
        tenantId: tenant.id,
        conversationId,
        detail: { ...usage, source: "reminder" },
      });
    }
    const text = ((json.candidates?.[0]?.content?.parts ?? []) as { text?: string }[])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    return text || fallback;
  } catch (e) {
    console.error("[reminders] generación falló, uso fallback:", (e as Error).message);
    return fallback;
  }
}

async function processConversation(
  tenant: Tenant,
  wa: WaCreds,
  conv: ConvRow
): Promise<"sent" | "skipped"> {
  const supabase = createAdminClient();
  const hours =
    (Date.now() - new Date(conv.last_customer_message_at).getTime()) / 3_600_000;

  // Fase según silencio y recordatorios ya enviados en este episodio.
  let phase: 1 | 2;
  if (hours >= PHASE2_MIN_HOURS && conv.reminder_count < 2) phase = 2;
  else if (hours >= PHASE1_MIN_HOURS && conv.reminder_count === 0) phase = 1;
  else return "skipped"; // aún no toca (o ya se envió el de esta fase)

  // Anti doble-envío si el cron se solapa: mínimo 2h entre recordatorios.
  if (
    conv.last_reminder_at &&
    Date.now() - new Date(conv.last_reminder_at).getTime() < 2 * 3_600_000
  ) {
    return "skipped";
  }

  // El último mensaje debe ser del bot (el cliente dejó la conversación a
  // medias; si el último es del cliente, es un fallo del worker, no silencio).
  const { data: last } = await supabase
    .from("messages")
    .select("sender")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last || last.sender !== "bot") return "skipped";

  // No fastidiar post-venta: si ya hay orden en esta conversación, silencio.
  const { count: orderCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conv.id);
  if ((orderCount ?? 0) > 0) return "skipped";

  const text = await generateReminderText(tenant, conv.id, phase);

  const waId = await sendText(wa, conv.customer_phone, text);
  await supabase.from("messages").insert({
    tenant_id: tenant.id,
    conversation_id: conv.id,
    wa_message_id: waId,
    sender: "bot",
    msg_type: "text",
    content: text,
  });
  await supabase.rpc("increment_message_counter", { p_tenant_id: tenant.id });
  await supabase
    .from("conversations")
    .update({
      // La fase 2 siempre cierra el episodio (aunque la 1 nunca se enviara).
      reminder_count: phase === 2 ? 2 : conv.reminder_count + 1,
      last_reminder_at: new Date().toISOString(),
    })
    .eq("id", conv.id);
  await logEvent({
    kind: "reminder",
    severity: "info",
    tenantId: tenant.id,
    conversationId: conv.id,
    detail: { phase, silence_hours: Math.round(hours * 10) / 10 },
  });
  return "sent";
}

// Barrido completo (lo dispara el cron horario). Devuelve conteos para el log.
export async function runReminderSweep(): Promise<{ sent: number; skipped: number }> {
  const supabase = createAdminClient();
  let sent = 0;
  let skipped = 0;

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, wa_phone_number_id, message_limit, current_month_messages")
    .eq("is_active", true)
    .eq("reminders_enabled", true)
    .not("wa_phone_number_id", "is", null);

  for (const t of tenants ?? []) {
    if ((t.current_month_messages ?? 0) >= (t.message_limit ?? 0)) continue;

    // Resolución completa (tenant + creds descifradas) reusando lib/tenant.
    let resolved;
    try {
      resolved = await getTenantByPhoneNumberId(t.wa_phone_number_id!);
    } catch (e) {
      console.error(`[reminders] tenant ${t.id} sin resolver:`, (e as Error).message);
      continue;
    }
    if (!resolved?.secrets.wa_access_token || !resolved.tenant.wa_phone_number_id) continue;
    const wa: WaCreds = {
      phoneNumberId: resolved.tenant.wa_phone_number_id,
      accessToken: resolved.secrets.wa_access_token,
    };

    const since = new Date(Date.now() - MAX_WINDOW_HOURS * 3_600_000).toISOString();
    const until = new Date(Date.now() - PHASE1_MIN_HOURS * 3_600_000).toISOString();
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, customer_phone, last_customer_message_at, reminder_count, last_reminder_at")
      .eq("tenant_id", t.id)
      .eq("status", "bot_active")
      .eq("is_test", false)
      .lt("reminder_count", 2)
      .gte("last_customer_message_at", since)
      .lte("last_customer_message_at", until)
      .limit(200);

    for (const conv of (convs ?? []) as ConvRow[]) {
      try {
        const result = await processConversation(resolved.tenant, wa, conv);
        if (result === "sent") sent++;
        else skipped++;
      } catch (e) {
        skipped++;
        await logEvent({
          kind: "reminder",
          severity: "warning",
          tenantId: t.id,
          conversationId: conv.id,
          detail: { error: (e as Error).message },
        });
      }
    }
  }

  return { sent, skipped };
}
