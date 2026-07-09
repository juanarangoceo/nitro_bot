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
