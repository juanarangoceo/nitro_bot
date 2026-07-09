// Escalado de una conversación a humano: única implementación compartida.
// La usan la herramienta `escalar_a_humano` (decisión de la IA) y el worker
// (escalado automático por fallo técnico, Feature A de la spec de operación).
// Centralizarla evita duplicar el par status+ticket y da un punto único para
// colgar notificaciones (Telegram al operador, correo al equipo del cliente).

import { createAdminClient } from "../supabase/admin";
import { notifyTicketEscalated } from "../notify/email";

export async function escalateToHuman(params: {
  tenantId: string;
  conversationId: string;
  reason: string;
}): Promise<{ ticketId: string | null }> {
  const { tenantId, conversationId, reason } = params;
  const supabase = createAdminClient();

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
    })
    .select("id")
    .maybeSingle();

  // Aviso por correo al equipo del cliente (best-effort: nunca rompe el escalado).
  await notifyTicketEscalated({ tenantId, conversationId, reason });

  return { ticketId: ticket?.id ?? null };
}
