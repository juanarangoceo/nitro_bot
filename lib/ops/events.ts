// Log de eventos de plataforma (event_log) — observabilidad de la operación.
// Tabla solo-service_role: el dashboard del cliente nunca la lee; se consulta
// desde /admin/health. TODO registro es best-effort: un fallo al loguear jamás
// puede tumbar el flujo que lo origina (regla de la spec de operación).
//
// REGLA: nunca poner tokens, claves ni datos sensibles en `detail`.

import { createAdminClient } from "../supabase/admin";
import { sendTelegramAlert, escTelegram } from "../notify/telegram";
import { explainAlertBrief } from "../notify/telegram-ai";

export type EventKind =
  | "assistant_error"
  | "tool_trace"
  | "queue_failure"
  | "escalation_auto"
  | "notify_failure"
  | "tts_failure"
  | "gemini_usage"
  | "oauth_failure"
  | "reminder"
  | "backup"
  | "support_request"
  | "video_received"
  | "stale_reply_dropped"
  | "wa_template_usage"
  | "wa_delivery_failure"
  | "cart_reminder"
  | "cart_optout"
  | "cart_click"
  | "payment_proof";

export type EventSeverity = "info" | "warning" | "error";

export async function logEvent(params: {
  kind: EventKind;
  severity?: EventSeverity;
  tenantId?: string | null;
  conversationId?: string | null;
  detail?: unknown;
}): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from("event_log").insert({
      kind: params.kind,
      severity: params.severity ?? "info",
      tenant_id: params.tenantId ?? null,
      conversation_id: params.conversationId ?? null,
      detail: (params.detail ?? null) as never,
    });
  } catch (e) {
    // Best-effort: si la DB también falla, solo consola.
    console.error("[ops] no se pudo registrar event_log:", e);
  }

  // Los ERRORES también van al Telegram del dueño (punto único: cubre
  // assistant_error, escalation_auto, queue_failure, oauth_failure y futuros).
  // sendTelegramAlert jamás lanza y es no-op sin las env vars. La alerta va
  // acompañada de una explicación breve de la IA (best-effort: si Gemini no
  // responde, la alerta sale igual que siempre).
  if (params.severity === "error") {
    const detail = JSON.stringify(params.detail ?? {}).slice(0, 200);
    const explanation = await explainAlertBrief({
      kind: params.kind,
      tenantId: params.tenantId,
      detail: params.detail,
    });
    await sendTelegramAlert(
      `🔴 <b>${escTelegram(params.kind)}</b>\n` +
        (params.tenantId ? `tenant: <code>${escTelegram(params.tenantId.slice(0, 8))}</code>\n` : "") +
        (params.conversationId
          ? `conv: <code>${escTelegram(params.conversationId.slice(0, 8))}</code>\n`
          : "") +
        escTelegram(detail) +
        (explanation ? `\n\n💬 ${escTelegram(explanation)}` : "")
    );
  }
}

// Resume una toolTrace para persistirla sin datos sensibles ni payloads
// gigantes: nombre, args truncados y ok/error por herramienta.
export function summarizeToolTrace(
  trace: { name: string; args: unknown; response: unknown }[]
): { name: string; args: string; ok: boolean; error?: string }[] {
  return trace.map((t) => {
    const resp = t.response as { error?: unknown; ok?: unknown } | null;
    const error =
      resp && typeof resp === "object" && "error" in resp && resp.error
        ? String(resp.error)
        : resp && typeof resp === "object" && resp.ok === false
          ? "ok=false"
          : undefined;
    return {
      name: t.name,
      args: JSON.stringify(t.args ?? {}).slice(0, 500),
      ok: !error,
      ...(error ? { error: error.slice(0, 500) } : {}),
    };
  });
}
