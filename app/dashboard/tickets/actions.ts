"use server";

// Acciones de tickets. La autorización se apoya en RLS: el cliente SSR
// (authenticated) solo puede leer/escribir filas de su tenant. Para ENVIAR por
// WhatsApp se necesitan los secretos del tenant (descifrados), que se cargan
// server-side acotados al tenant del contexto.

import { getDashboardContext } from "@/lib/dashboard/context";
import { getTenantBySlug } from "@/lib/tenant";
import { sendText } from "@/lib/whatsapp/meta";
import { revalidatePath } from "next/cache";

export type ReplyState = { ok: boolean; error: string | null };

// Responde un ticket: envía el mensaje del agente por WhatsApp, lo persiste y
// pasa la conversación a 'human_active' (el bot deja de responder).
export async function replyToTicket(
  _prev: ReplyState,
  formData: FormData
): Promise<ReplyState> {
  const { tenant, supabase } = await getDashboardContext();
  const conversationId = String(formData.get("conversation_id") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!conversationId || !text) return { ok: false, error: "Falta el mensaje." };

  // Verifica que la conversación es del tenant (RLS) y trae el teléfono.
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, customer_phone")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return { ok: false, error: "Conversación no encontrada." };

  // Secretos del tenant para enviar por la Cloud API.
  if (!tenant.slug) return { ok: false, error: "Tenant sin slug." };
  const resolved = await getTenantBySlug(tenant.slug);
  if (!resolved?.tenant.wa_phone_number_id || !resolved.secrets.wa_access_token) {
    return { ok: false, error: "El tenant no tiene WhatsApp configurado." };
  }

  try {
    const waId = await sendText(
      {
        phoneNumberId: resolved.tenant.wa_phone_number_id,
        accessToken: resolved.secrets.wa_access_token,
      },
      conv.customer_phone,
      text
    );

    await supabase.from("messages").insert({
      tenant_id: tenant.id,
      conversation_id: conversationId,
      wa_message_id: waId,
      sender: "agent",
      msg_type: "text",
      content: text,
    });
    await supabase
      .from("conversations")
      .update({ status: "human_active" })
      .eq("id", conversationId);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  revalidatePath("/dashboard/tickets");
  return { ok: true, error: null };
}

// Resuelve un ticket y devuelve la conversación al bot.
export async function resolveTicket(formData: FormData): Promise<void> {
  const { supabase } = await getDashboardContext();
  const ticketId = String(formData.get("ticket_id") ?? "");
  const conversationId = String(formData.get("conversation_id") ?? "");
  if (!ticketId) return;

  await supabase
    .from("tickets")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", ticketId);
  if (conversationId) {
    await supabase
      .from("conversations")
      .update({ status: "bot_active" })
      .eq("id", conversationId);
  }
  revalidatePath("/dashboard/tickets");
}
