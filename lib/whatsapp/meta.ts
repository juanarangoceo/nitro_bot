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
