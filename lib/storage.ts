// Helpers de Supabase Storage para la media de WhatsApp (bucket privado
// `wa-media`). Todo server-side con service_role. El navegador nunca toca el
// bucket: lee vía un Route Handler que firma URLs (app/dashboard/media/[id]).
// Convención de ruta: {tenant_id}/{conversation_id}/{message_id}.{ext}

import { createAdminClient } from "./supabase/admin";

const BUCKET = "wa-media";

// Extensión a partir del mime (suficiente para audio/imagen de WhatsApp).
// Meta manda parámetros (p. ej. `audio/ogg; codecs=opus`): se recortan para
// que el lookup no caiga a `.bin`.
function extFor(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/amr": "amr",
    "audio/aac": "aac",
    "video/mp4": "mp4",
    "video/3gpp": "3gp",
  };
  return map[mime.split(";")[0].trim().toLowerCase()] ?? "bin";
}

// Sube bytes y devuelve la key del objeto (media_path). Best-effort: el llamador
// decide qué hacer si lanza.
export async function uploadWaMedia(params: {
  tenantId: string;
  conversationId: string;
  messageId: string;
  bytes: Uint8Array | Buffer;
  mimeType: string;
}): Promise<string> {
  const path = `${params.tenantId}/${params.conversationId}/${params.messageId}.${extFor(
    params.mimeType
  )}`;
  const supabase = createAdminClient();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, Buffer.from(params.bytes), {
      contentType: params.mimeType,
      upsert: true,
    });
  if (error) throw new Error(`Storage upload falló: ${error.message}`);
  return path;
}

// URL firmada de SUBIDA para que el navegador cargue media directo al bucket
// (el body de una Server Action en Vercel tope a 4,5 MB; los videos de
// WhatsApp llegan a 16 MB). El token solo autoriza escribir ese path exacto.
export async function createWaMediaUploadUrl(params: {
  tenantId: string;
  conversationId: string;
  messageId: string;
  mimeType: string;
}): Promise<{ path: string; token: string }> {
  const path = `${params.tenantId}/${params.conversationId}/${params.messageId}.${extFor(
    params.mimeType
  )}`;
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data?.token) {
    throw new Error(`Storage signed upload falló: ${error?.message ?? "sin token"}`);
  }
  return { path, token: data.token };
}

// Sube el logo del tenant al bucket PÚBLICO `branding` y devuelve la URL
// pública con ?v= para reventar caché al reemplazarlo (la key es estable).
export async function uploadTenantLogo(params: {
  tenantId: string;
  bytes: Uint8Array | Buffer;
  mimeType: string;
}): Promise<string> {
  const path = `${params.tenantId}/logo.${extFor(params.mimeType)}`;
  const supabase = createAdminClient();
  const { error } = await supabase.storage
    .from("branding")
    .upload(path, Buffer.from(params.bytes), {
      contentType: params.mimeType,
      upsert: true,
    });
  if (error) throw new Error(`Storage upload falló: ${error.message}`);
  const { data } = supabase.storage.from("branding").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

// Descarga la media de un mensaje ya persistido (para re-adjuntarla inline a
// Gemini cuando el turno coalesce varios mensajes). Best-effort: null si falla.
export async function downloadWaMedia(path: string): Promise<Buffer | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

// Firma una URL temporal de lectura (default 60s) para mostrar la media en el panel.
export async function signedMediaUrl(
  path: string,
  expiresIn = 60
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}
