// Asistente de operaciones por Telegram para el DUEÑO de la plataforma:
// (a) explica en lenguaje sencillo las alertas de error que salen por
//     Telegram (logEvent severity=error), y
// (b) responde preguntas del dueño sobre el estado real de la plataforma
//     (webhook /api/telegram/webhook), con un snapshot compacto de la DB.
//
// Todo best-effort (patrón email/tts/telegram): JAMÁS lanza. Gemini va con
// thinkingBudget: 0 (respuestas cortas, sin razonar — precedente spec 11).

import { env } from "../env";
import { createAdminClient } from "../supabase/admin";
import { bogotaDayStart } from "../dates";

// Modelo de plataforma (no hay tenant en este contexto).
const OPS_MODEL = "gemini-3.5-flash";
const GEMINI_TIMEOUT_MS = 15_000;

async function geminiText(
  system: string,
  userText: string,
  usageSource: string
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${OPS_MODEL}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: userText }] }],
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
          }),
          signal: controller.signal,
        }
      );
      const json = await res.json();
      if (!res.ok || json.error) {
        console.error("[telegram-ai] Gemini falló:", json.error?.message ?? res.status);
        return null;
      }
      // Medición de tokens en la misma traza gemini_usage de /admin/health.
      // Insert directo (no logEvent: events.ts importa este módulo y sería
      // un import circular). Best-effort.
      const u = json.usageMetadata as
        | { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
        | undefined;
      if (u) {
        try {
          await createAdminClient()
            .from("event_log")
            .insert({
              kind: "gemini_usage",
              severity: "info",
              detail: {
                calls: 1,
                promptTokens: u.promptTokenCount ?? 0,
                outputTokens: u.candidatesTokenCount ?? 0,
                thoughtsTokens: u.thoughtsTokenCount ?? 0,
                source: usageSource,
              },
            });
        } catch {
          // la medición jamás bloquea la respuesta
        }
      }
      const text = ((json.candidates?.[0]?.content?.parts ?? []) as { text?: string }[])
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      return text || null;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error("[telegram-ai] Gemini no respondió:", (e as Error).message);
    return null;
  }
}

// (a) Explicación breve de una alerta de error, para anexar al mensaje.
// null si Gemini no responde (la alerta sale igual, como hoy).
export async function explainAlertBrief(params: {
  kind: string;
  tenantId?: string | null;
  detail?: unknown;
}): Promise<string | null> {
  const system =
    "Eres el asistente de operaciones de Nitro Bot, un SaaS que automatiza ventas por WhatsApp con IA para tiendas Shopify (webhook de Meta → worker → Gemini → respuesta; dashboard para las tiendas; panel /admin del dueño). " +
    "Te paso un evento de error del sistema. Explica al DUEÑO en español sencillo y en MÁXIMO 2 frases: qué significa y si requiere acción suya o puede esperar. Sin tecnicismos innecesarios, sin markdown, sin saludos.";
  const text = `Evento: ${params.kind}\nDetalle: ${JSON.stringify(params.detail ?? {}).slice(0, 600)}`;
  const out = await geminiText(system, text, "alert_explain");
  return out ? out.slice(0, 400) : null;
}

// Snapshot compacto del estado real de la plataforma para que el asistente
// responda "conectado a la app". Solo lectura, service_role.
async function buildPlatformSnapshot(): Promise<string> {
  const supabase = createAdminClient();
  const todayBogota = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Bogota",
  });
  const today = bogotaDayStart(todayBogota) ?? new Date().toISOString().slice(0, 10);
  const h24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const [tenants, msgs, convs, orders, tickets, events] = await Promise.all([
    supabase
      .from("tenants")
      .select(
        "name, plan, message_limit, current_month_messages, addon_enabled, billing_status, billing_due_date, service_paused, is_active"
      ),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .gte("created_at", today),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .gte("created_at", today)
      .eq("is_test", false),
    supabase.from("orders").select("total").gte("created_at", today),
    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    supabase
      .from("event_log")
      .select("kind, severity, detail, created_at")
      .in("severity", ["warning", "error"])
      .gte("created_at", h24)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const ventasHoy = (orders.data ?? []).reduce((s, o) => s + Number(o.total ?? 0), 0);
  return JSON.stringify({
    fecha_bogota: new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" }),
    clientes: (tenants.data ?? []).map((t) => ({
      nombre: t.name,
      plan: t.plan,
      consumo: `${t.current_month_messages}/${t.message_limit}${t.addon_enabled ? "+2000 adicional" : ""}`,
      facturacion: t.billing_status,
      corte: t.billing_due_date,
      bot_suspendido: t.service_paused,
      activo: t.is_active,
    })),
    hoy: {
      mensajes: msgs.count ?? 0,
      conversaciones_nuevas: convs.count ?? 0,
      ordenes: (orders.data ?? []).length,
      ventas_cop: ventasHoy,
      tickets_abiertos: tickets.count ?? 0,
    },
    errores_warnings_24h: (events.data ?? []).map((e) => ({
      kind: e.kind,
      severity: e.severity,
      cuando: e.created_at,
      detalle: JSON.stringify(e.detail ?? {}).slice(0, 200),
    })),
  });
}

const HISTORY_LIMIT = 10;
const HISTORY_WINDOW_MS = 6 * 3600 * 1000;

// (b) Responde una pregunta del dueño con contexto real + historial corto.
export async function answerOwnerQuestion(question: string): Promise<string> {
  const supabase = createAdminClient();

  // Persistir la pregunta (best-effort) y traer el hilo reciente.
  await supabase.from("admin_chat_log").insert({ role: "user", content: question.slice(0, 2000) });
  const { data: hist } = await supabase
    .from("admin_chat_log")
    .select("role, content")
    .gte("created_at", new Date(Date.now() - HISTORY_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const thread = (hist ?? [])
    .reverse()
    .map((m) => `${m.role === "user" ? "Dueño" : "Tú"}: ${m.content}`)
    .join("\n");

  let snapshot = "{}";
  try {
    snapshot = await buildPlatformSnapshot();
  } catch (e) {
    console.error("[telegram-ai] snapshot falló:", (e as Error).message);
  }

  const system =
    "Eres el asistente de operaciones de Nitro Bot (SaaS de ventas por WhatsApp con IA para tiendas Shopify; empresa Nitro Ecom, dueño Juan). Hablas con Juan por Telegram. " +
    "Responde en español, CORTO (máximo ~5 frases o una lista breve), directo y sin markdown complejo (Telegram simple). Usa los datos del snapshot para responder con cifras reales; si algo no está en el snapshot, dilo honestamente y sugiere dónde verlo (/admin/health, /admin, dashboard). Nunca inventes datos.";

  const userText =
    `SNAPSHOT ACTUAL DE LA PLATAFORMA (datos reales):\n${snapshot}\n\n` +
    (thread ? `CONVERSACIÓN RECIENTE:\n${thread}\n\n` : "") +
    `PREGUNTA DEL DUEÑO: ${question}`;

  const answer =
    (await geminiText(system, userText, "telegram_assistant")) ??
    "No pude consultar la IA en este momento. Revisa /admin/health para el detalle, o inténtalo de nuevo en un minuto.";

  await supabase
    .from("admin_chat_log")
    .insert({ role: "assistant", content: answer.slice(0, 4000) });
  return answer;
}
