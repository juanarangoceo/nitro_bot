"use server";

// Acciones de tickets. La autorización se apoya en RLS: el cliente SSR
// (authenticated) solo puede leer/escribir filas de su tenant. Para ENVIAR por
// WhatsApp se necesitan los secretos del tenant (descifrados), que se cargan
// server-side acotados al tenant del contexto.

import { getDashboardContext } from "@/lib/dashboard/context";
import { getTenantBySlug } from "@/lib/tenant";
import { sendText, sendImage, sendAudio, uploadMedia, type WaCreds } from "@/lib/whatsapp/meta";
import { uploadWaMedia } from "@/lib/storage";
import { revalidatePath } from "next/cache";
import crypto from "node:crypto";

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

// Envía una foto o un audio al cliente desde el panel. Sube el archivo a Meta
// (uploadMedia → media_id), lo manda por la Cloud API, lo persiste en Storage
// para el historial y pasa la conversación a 'human_active'.
const MAX_MEDIA_BYTES = 16 * 1024 * 1024; // 16 MB (límite cómodo para WhatsApp)

export async function sendMediaFromAgent(
  _prev: ReplyState,
  formData: FormData
): Promise<ReplyState> {
  const { tenant, supabase } = await getDashboardContext();
  const conversationId = String(formData.get("conversation_id") ?? "");
  const file = formData.get("file");
  if (!conversationId) return { ok: false, error: "Falta la conversación." };
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "Selecciona un archivo." };
  if (file.size > MAX_MEDIA_BYTES) return { ok: false, error: "El archivo es muy grande." };

  const mime = file.type || "application/octet-stream";
  const kind: "image" | "audio" = mime.startsWith("image/")
    ? "image"
    : mime.startsWith("audio/")
      ? "audio"
      : (() => {
          throw new Error("Solo se admiten imágenes o audios.");
        })();

  // Conversación del tenant (RLS) + teléfono.
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, customer_phone")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return { ok: false, error: "Conversación no encontrada." };

  if (!tenant.slug) return { ok: false, error: "Tenant sin slug." };
  const resolved = await getTenantBySlug(tenant.slug);
  if (!resolved?.tenant.wa_phone_number_id || !resolved.secrets.wa_access_token) {
    return { ok: false, error: "El tenant no tiene WhatsApp configurado." };
  }
  const wa: WaCreds = {
    phoneNumberId: resolved.tenant.wa_phone_number_id,
    accessToken: resolved.secrets.wa_access_token,
  };

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const mediaId = await uploadMedia(wa, bytes, mime, file.name || `media.${kind}`);
    const waId =
      kind === "image"
        ? await sendImage(wa, conv.customer_phone, { id: mediaId })
        : await sendAudio(wa, conv.customer_phone, { id: mediaId });

    // Persistir en Storage para mostrarlo en el historial del panel (best-effort).
    let mediaPath: string | null = null;
    try {
      mediaPath = await uploadWaMedia({
        tenantId: tenant.id,
        conversationId,
        messageId: crypto.randomUUID(),
        bytes,
        mimeType: mime,
      });
    } catch {
      // si falla el guardado, el mensaje igual se envió.
    }

    await supabase.from("messages").insert({
      tenant_id: tenant.id,
      conversation_id: conversationId,
      wa_message_id: waId,
      sender: "agent",
      msg_type: kind,
      content: kind === "image" ? "[imagen]" : "[nota de voz]",
      media_path: mediaPath,
      media_mime: mime,
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
