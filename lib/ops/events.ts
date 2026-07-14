// Log de eventos de plataforma (event_log) — observabilidad de la operación.
// Tabla solo-service_role: el dashboard del cliente nunca la lee; se consulta
// desde /admin/health. TODO registro es best-effort: un fallo al loguear jamás
// puede tumbar el flujo que lo origina (regla de la spec de operación).
//
// REGLA: nunca poner tokens, claves ni datos sensibles en `detail`.

import { createAdminClient } from "../supabase/admin";

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
  | "stale_reply_dropped";

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
