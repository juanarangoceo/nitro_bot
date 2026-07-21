"use server";

// Acciones de tickets. La autorización se apoya en RLS: el cliente SSR
// (authenticated) solo puede leer/escribir filas de su tenant. Para ENVIAR por
// WhatsApp se necesitan los secretos del tenant (descifrados), que se cargan
// server-side acotados al tenant del contexto.

import { getDashboardContext } from "@/lib/dashboard/context";
import { getTenantBySlug } from "@/lib/tenant";
import {
  sendText,
  sendImage,
  sendAudio,
  sendVideo,
  uploadMedia,
  type WaCreds,
} from "@/lib/whatsapp/meta";
import { createWaMediaUploadUrl, downloadWaMedia } from "@/lib/storage";
import { revalidatePath } from "next/cache";
import crypto from "node:crypto";

export type ReplyState = { ok: boolean; error: string | null };

// Responde un ticket: envía el mensaje del agente por WhatsApp, lo persiste y
// pasa la conversación a 'human_active' (el bot deja de responder).
export async function replyToTicket(
  _prev: ReplyState,
  formData: FormData
): Promise<ReplyState> {
  const { tenant, supabase, user } = await getDashboardContext();
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
      // Autoría server-side (jamás del form): quién del equipo respondió.
      sent_by: user.id,
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

// Envío de media del agente en dos pasos: el body de una función en Vercel
// tope a 4,5 MB (límite de plataforma, no configurable), así que el archivo
// JAMÁS pasa por una Server Action. El navegador pide una URL firmada de
// subida (prepareAgentMediaUpload), carga el archivo DIRECTO a Supabase
// Storage y luego una action liviana (sendUploadedMediaFromAgent) lo baja de
// Storage, lo sube a Meta y lo envía por WhatsApp.
const MAX_MEDIA_BYTES = 16 * 1024 * 1024; // 16 MB (límite de WhatsApp para video)

// WhatsApp solo acepta estos contenedores de video (H.264 + AAC). Un .mov de
// iPhone (video/quicktime) o un .webm serían rechazados por Meta.
const VIDEO_MIMES = new Set(["video/mp4", "video/3gpp"]);

type MediaKind = "image" | "audio" | "video";

function mediaKindFor(mime: string): MediaKind | null {
  const clean = mime.split(";")[0].trim().toLowerCase();
  if (clean.startsWith("image/")) return "image";
  if (clean.startsWith("audio/")) return "audio";
  if (clean.startsWith("video/")) return VIDEO_MIMES.has(clean) ? "video" : null;
  return null;
}

export type PrepareUploadResult =
  | { ok: true; path: string; token: string }
  | { ok: false; error: string };

// Paso 1: valida sesión/conversación/tipo/tamaño y firma la URL de subida.
export async function prepareAgentMediaUpload(
  conversationId: string,
  mime: string,
  size: number
): Promise<PrepareUploadResult> {
  const { tenant, supabase } = await getDashboardContext();
  if (!conversationId) return { ok: false, error: "Falta la conversación." };
  if (!size) return { ok: false, error: "Selecciona un archivo." };
  if (size > MAX_MEDIA_BYTES)
    return { ok: false, error: "El archivo supera los 16 MB que acepta WhatsApp." };
  const kind = mediaKindFor(mime);
  if (!kind) {
    return {
      ok: false,
      error: mime.startsWith("video/")
        ? "WhatsApp solo acepta videos MP4. Convierte el video a MP4 e inténtalo de nuevo."
        : "Solo se admiten imágenes, audios o videos MP4.",
    };
  }

  // Conversación del tenant (RLS): sin esto no se firma nada.
  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return { ok: false, error: "Conversación no encontrada." };

  try {
    const { path, token } = await createWaMediaUploadUrl({
      tenantId: tenant.id,
      conversationId,
      messageId: crypto.randomUUID(),
      mimeType: mime,
    });
    return { ok: true, path, token };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Paso 2: con el archivo ya en Storage, lo manda por WhatsApp y lo persiste.
export async function sendUploadedMediaFromAgent(
  conversationId: string,
  path: string,
  mime: string
): Promise<ReplyState> {
  const { tenant, supabase, user } = await getDashboardContext();
  if (!conversationId || !path) return { ok: false, error: "Falta el archivo." };
  const kind = mediaKindFor(mime);
  if (!kind) return { ok: false, error: "Tipo de archivo no admitido." };

  // El path DEBE ser de esta conversación de este tenant (el prefijo lo generó
  // prepareAgentMediaUpload): bloquea paths ajenos inventados por el cliente.
  if (!path.startsWith(`${tenant.id}/${conversationId}/`)) {
    return { ok: false, error: "Archivo no válido." };
  }

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
    const bytes = await downloadWaMedia(path);
    if (!bytes) return { ok: false, error: "La subida no se completó. Inténtalo de nuevo." };
    if (bytes.length > MAX_MEDIA_BYTES)
      return { ok: false, error: "El archivo supera los 16 MB que acepta WhatsApp." };

    const mediaId = await uploadMedia(
      wa,
      bytes,
      mime,
      kind === "video" ? "media.mp4" : `media.${kind}`
    );
    const waId =
      kind === "image"
        ? await sendImage(wa, conv.customer_phone, { id: mediaId })
        : kind === "audio"
          ? await sendAudio(wa, conv.customer_phone, { id: mediaId })
          : await sendVideo(wa, conv.customer_phone, { id: mediaId });

    await supabase.from("messages").insert({
      tenant_id: tenant.id,
      conversation_id: conversationId,
      wa_message_id: waId,
      sender: "agent",
      msg_type: kind,
      content:
        kind === "image" ? "[imagen]" : kind === "audio" ? "[nota de voz]" : "[video]",
      media_path: path,
      media_mime: mime,
      sent_by: user.id,
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
  const { supabase, user } = await getDashboardContext();
  const ticketId = String(formData.get("ticket_id") ?? "");
  const conversationId = String(formData.get("conversation_id") ?? "");
  if (!ticketId) return;

  await supabase
    .from("tickets")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq("id", ticketId);
  if (conversationId) {
    await supabase
      .from("conversations")
      .update({ status: "bot_active" })
      .eq("id", conversationId);
  }
  revalidatePath("/dashboard/tickets");
}
