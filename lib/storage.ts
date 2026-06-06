// Helpers de Supabase Storage para la media de WhatsApp (bucket privado
// `wa-media`). Todo server-side con service_role. El navegador nunca toca el
// bucket: lee vía un Route Handler que firma URLs (app/dashboard/media/[id]).
// Convención de ruta: {tenant_id}/{conversation_id}/{message_id}.{ext}

import { createAdminClient } from "./supabase/admin";

const BUCKET = "wa-media";

// Extensión a partir del mime (suficiente para audio/imagen de WhatsApp).
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
  };
  return map[mime] ?? "bin";
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
