// Cliente de la WhatsApp Cloud API (Meta Graph) por tenant.
// - Envío de mensajes de texto al cliente.
// - Descarga de media (notas de voz / imágenes) para el procesamiento multimodal.
//
// Credenciales: el `phone_number_id` es del tenant (tenants.wa_phone_number_id) y
// el access token es por tenant (tenant_secrets.wa_access_token, descifrado).
// El App Secret y el Verify Token son globales de la app (lib/env.ts) y se usan
// en el webhook, no aquí.

// Versión del Graph API. Centralizada para subirla en un solo lugar.
const GRAPH_VERSION = "v23.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type WaCreds = {
  phoneNumberId: string; // tenants.wa_phone_number_id
  accessToken: string; // tenant_secrets.wa_access_token (descifrado)
};

export type DownloadedMedia = {
  mimeType: string;
  base64: string;
};

// Envía un mensaje de texto al cliente por WhatsApp.
// Devuelve el wa_message_id del mensaje saliente (útil para trazabilidad).
export async function sendText(
  creds: WaCreds,
  to: string,
  body: string
): Promise<string | null> {
  const res = await fetch(`${GRAPH_BASE}/${creds.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      // preview_url: deja que Meta resuelva links si los hay.
      text: { preview_url: true, body },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Meta sendText falló (${res.status}): ${JSON.stringify(json?.error ?? json)}`
    );
  }
  return json?.messages?.[0]?.id ?? null;
}

// Envía una imagen al cliente. Acepta `link` (URL pública, p.ej. la imagen de
// Shopify) o `id` (media previamente subida a Meta con uploadMedia).
export async function sendImage(
  creds: WaCreds,
  to: string,
  media: { link?: string; id?: string; caption?: string }
): Promise<string | null> {
  const image: Record<string, string> = {};
  if (media.id) image.id = media.id;
  else if (media.link) image.link = media.link;
  if (media.caption) image.caption = media.caption;

  const res = await fetch(`${GRAPH_BASE}/${creds.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "image",
      image,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Meta sendImage falló (${res.status}): ${JSON.stringify(json?.error ?? json)}`
    );
  }
  return json?.messages?.[0]?.id ?? null;
}

// Envía un audio (nota de voz) al cliente. Acepta `link` o `id` (uploadMedia).
export async function sendAudio(
  creds: WaCreds,
  to: string,
  media: { link?: string; id?: string }
): Promise<string | null> {
  const audio: Record<string, string> = {};
  if (media.id) audio.id = media.id;
  else if (media.link) audio.link = media.link;

  const res = await fetch(`${GRAPH_BASE}/${creds.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "audio",
      audio,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Meta sendAudio falló (${res.status}): ${JSON.stringify(json?.error ?? json)}`
    );
  }
  return json?.messages?.[0]?.id ?? null;
}

// Sube un binario a la media library del número y devuelve su media_id, listo
// para enviar con sendImage/sendAudio por `id`. Necesario para media que NO
// tiene URL pública (p.ej. una foto que el agente sube desde el panel).
export async function uploadMedia(
  creds: WaCreds,
  bytes: Uint8Array | Buffer,
  mimeType: string,
  filename: string
): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append(
    "file",
    new Blob([Buffer.from(bytes)], { type: mimeType }),
    filename
  );
  const res = await fetch(`${GRAPH_BASE}/${creds.phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.accessToken}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.id) {
    throw new Error(
      `Meta uploadMedia falló (${res.status}): ${JSON.stringify(json?.error ?? json)}`
    );
  }
  return json.id as string;
}

// Marca un mensaje entrante como leído (palomitas azules). Best-effort.
export async function markAsRead(creds: WaCreds, waMessageId: string): Promise<void> {
  try {
    await fetch(`${GRAPH_BASE}/${creds.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: waMessageId,
      }),
    });
  } catch (e) {
    console.error("[meta] markAsRead falló:", e);
  }
}

// Descarga media por su id en dos pasos: 1) resuelve la URL temporal del binario,
// 2) baja los bytes (requiere el Bearer token). Devuelve base64 listo para enviar
// a Gemini como inlineData. Null si algo falla (el worker degradará a solo-texto).
export async function downloadMedia(
  creds: WaCreds,
  mediaId: string
): Promise<DownloadedMedia | null> {
  try {
    const metaRes = await fetch(`${GRAPH_BASE}/${mediaId}`, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!meta.url) return null;

    const binRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
    if (!binRes.ok) return null;
    const buf = Buffer.from(await binRes.arrayBuffer());
    return {
      mimeType: meta.mime_type ?? "application/octet-stream",
      base64: buf.toString("base64"),
    };
  } catch (e) {
    console.error("[meta] downloadMedia falló:", e);
    return null;
  }
}

// ── Aprovisionamiento: suscripción de WABA y perfil del número ──────────────

// Suscribe la WABA del cliente a la app de Nitro Ecom para que sus mensajes
// lleguen al webhook único. Idempotente: si ya está suscrita, Meta responde OK.
// El token es el System User token del cliente (con permisos sobre la WABA).
export async function subscribeWabaToApp(
  wabaId: string,
  token: string
): Promise<void> {
  const res = await fetch(`${GRAPH_BASE}/${wabaId}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(
      `Meta subscribeWabaToApp falló (${res.status}): ${JSON.stringify(json?.error ?? json)}`
    );
  }
}

export type BusinessProfile = {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  websites?: string[];
  profile_picture_handle?: string;
};

// Configura el perfil de negocio del número (foto + datos), para que cada
// cliente se vea como su propia marca. `profile_picture_handle` se obtiene de
// uploadProfilePhoto (resumable upload).
export async function setBusinessProfile(
  phoneNumberId: string,
  token: string,
  profile: BusinessProfile
): Promise<void> {
  const body: Record<string, unknown> = { messaging_product: "whatsapp" };
  for (const [k, v] of Object.entries(profile)) {
    if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) {
      body[k] = v;
    }
  }
  const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/whatsapp_business_profile`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(
      `Meta setBusinessProfile falló (${res.status}): ${JSON.stringify(json?.error ?? json)}`
    );
  }
}

// Sube una foto de perfil vía resumable upload de la Graph API y devuelve el
// `handle` que espera setBusinessProfile. Requiere el App ID de la app de Meta
// (META_APP_ID). Si no está configurado, el llamador debe omitir la foto.
export async function uploadProfilePhoto(params: {
  appId: string;
  token: string;
  bytes: Uint8Array | Buffer;
  mimeType: string;
}): Promise<string> {
  const buf = Buffer.from(params.bytes);
  // 1) Iniciar sesión de subida.
  const startRes = await fetch(
    `${GRAPH_BASE}/${params.appId}/uploads?file_length=${buf.length}&file_type=${encodeURIComponent(
      params.mimeType
    )}`,
    { method: "POST", headers: { Authorization: `Bearer ${params.token}` } }
  );
  const startJson = await startRes.json().catch(() => ({}));
  if (!startRes.ok || !startJson?.id) {
    throw new Error(
      `Meta uploadProfilePhoto (start) falló (${startRes.status}): ${JSON.stringify(
        startJson?.error ?? startJson
      )}`
    );
  }
  const sessionId: string = startJson.id; // "upload:<...>"

  // 2) Subir los bytes; devuelve el handle (h).
  const upRes = await fetch(`${GRAPH_BASE}/${sessionId}`, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${params.token}`,
      file_offset: "0",
      "Content-Type": params.mimeType,
    },
    body: new Uint8Array(buf),
  });
  const upJson = await upRes.json().catch(() => ({}));
  if (!upRes.ok || !upJson?.h) {
    throw new Error(
      `Meta uploadProfilePhoto (upload) falló (${upRes.status}): ${JSON.stringify(
        upJson?.error ?? upJson
      )}`
    );
  }
  return upJson.h as string;
}

// ── Tipos del payload entrante de Meta (subset que usamos) ──────────────────

export type WaInboundMessage = {
  from: string; // teléfono del cliente (E.164 sin '+')
  id: string; // wa_message_id (wamid...)
  timestamp: string;
  type: "text" | "audio" | "image" | "video" | "document" | "sticker" | string;
  text?: { body: string };
  audio?: { id: string; mime_type?: string; voice?: boolean };
  image?: { id: string; mime_type?: string; caption?: string };
};

export type WaValue = {
  messaging_product: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { profile?: { name?: string }; wa_id?: string }[];
  messages?: WaInboundMessage[];
  statuses?: unknown[]; // entregas/lecturas — las ignoramos
};

export type WaWebhookBody = {
  object?: string;
  entry?: { id?: string; changes?: { value?: WaValue; field?: string }[] }[];
};

// Extrae los pares (value, message) entrantes de un payload, ignorando los
// eventos de estado (statuses) que no traen `messages`.
export function extractInboundMessages(
  body: WaWebhookBody
): { value: WaValue; message: WaInboundMessage }[] {
  const out: { value: WaValue; message: WaInboundMessage }[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages?.length) continue;
      for (const message of value.messages) {
        out.push({ value, message });
      }
    }
  }
  return out;
}
