"use server";

// Cerrar una conversación desde el dashboard del cliente. RLS garantiza que
// solo se puede cerrar una conversación del propio tenant. closed_at marca el
// corte de contexto: si el cliente final vuelve a escribir, el worker reactiva
// la conversación y la IA arranca sin el historial anterior al cierre. El dato
// histórico no se borra (métricas y CRM intactos).

import { getDashboardContext } from "@/lib/dashboard/context";
import { revalidatePath } from "next/cache";

export async function closeConversation(fd: FormData): Promise<void> {
  const { supabase } = await getDashboardContext();
  const conversationId = String(fd.get("conversation_id") ?? "");
  if (!conversationId) return;

  await supabase
    .from("conversations")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", conversationId);

  revalidatePath("/dashboard/conversations");
}

// Pasar la conversación a Tickets a mano: el equipo detectó que puede
// responder mejor que el bot. Deja la conversación en requires_human (el bot
// se calla) y crea el ticket SIN etiqueta y sin correo de aviso (el aviso es
// para el equipo, que es quien lo está haciendo). Se puede elegir a QUIÉN va:
// assigned_to vacío = general (lo ve todo el equipo según sus etiquetas);
// con usuario, solo esa persona (+ el admin) lo ve — lo impone RLS (0030).
// Desde /dashboard/tickets se responde y al resolver vuelve al bot — el mismo
// ciclo de un escalado del asesor.
export async function sendToTickets(fd: FormData): Promise<void> {
  const { tenant, supabase } = await getDashboardContext();
  const conversationId = String(fd.get("conversation_id") ?? "");
  if (!conversationId) return;

  // El destinatario debe ser del propio tenant: se valida contra app_users
  // (RLS app_users_team_select solo devuelve el equipo propio). Un id ajeno o
  // inválido cae a general — la FK compuesta de 0030 lo bloquearía igual.
  const assignedRaw = String(fd.get("assigned_to") ?? "").trim();
  let assignedTo: string | null = null;
  if (assignedRaw) {
    const { data: member } = await supabase
      .from("app_users")
      .select("id")
      .eq("id", assignedRaw)
      .maybeSingle();
    assignedTo = member?.id ?? null;
  }

  // Si ya está escalada (requires_human/human_active) ya hay ticket: no-op.
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, status")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv || conv.status === "requires_human" || conv.status === "human_active") return;

  await supabase
    .from("conversations")
    .update({ status: "requires_human" })
    .eq("id", conversationId);
  await supabase.from("tickets").insert({
    tenant_id: tenant.id,
    conversation_id: conversationId,
    reason: "intervencion_manual",
    status: "open",
    assigned_to: assignedTo,
  });

  revalidatePath("/dashboard/conversations");
  revalidatePath("/dashboard/tickets");
}

// Eliminar una conversación definitivamente. El cascade de la FK borra sus
// mensajes y tickets; las órdenes ya creadas se conservan (conversation_id
// queda en null). RLS limita el borrado al propio tenant.
export async function deleteConversation(fd: FormData): Promise<void> {
  const { supabase } = await getDashboardContext();
  const conversationId = String(fd.get("conversation_id") ?? "");
  if (!conversationId) return;

  await supabase.from("conversations").delete().eq("id", conversationId);

  revalidatePath("/dashboard/conversations");
}
