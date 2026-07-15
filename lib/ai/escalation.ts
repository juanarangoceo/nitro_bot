// Escalado de una conversación a humano: única implementación compartida.
// La usan la herramienta `escalar_a_humano` (decisión de la IA) y el worker
// (escalado automático por fallo técnico, Feature A de la spec de operación).
// Centralizarla evita duplicar el par status+ticket y da un punto único para
// colgar notificaciones (Telegram al operador, correo al equipo del cliente).

import { createAdminClient } from "../supabase/admin";
import { notifyTicketEscalated } from "../notify/email";
import { loadActiveLabels, resolveLabelId } from "../tickets/labels";

export async function escalateToHuman(params: {
  tenantId: string;
  conversationId: string;
  reason: string;
  // Etiqueta ya resuelta por el llamador (escalar_a_humano). undefined =
  // resolver aquí por el motivo (escalados automáticos del worker); null =
  // sin etiqueta a propósito.
  labelId?: string | null;
}): Promise<{ ticketId: string | null }> {
  const { tenantId, conversationId, reason } = params;
  const supabase = createAdminClient();

  const labelId =
    params.labelId !== undefined
      ? params.labelId
      : resolveLabelId(await loadActiveLabels(tenantId), null, reason);

  await supabase
    .from("conversations")
    .update({ status: "requires_human" })
    .eq("id", conversationId)
    .eq("tenant_id", tenantId);

  const { data: ticket } = await supabase
    .from("tickets")
    .insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      reason,
      status: "open",
      label_id: labelId,
    })
    .select("id")
    .maybeSingle();

  // Aviso por correo al equipo del cliente (best-effort: nunca rompe el escalado).
  await notifyTicketEscalated({ tenantId, conversationId, reason });

  return { ticketId: ticket?.id ?? null };
}
