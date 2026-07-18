// Webhook de WhatsApp (Meta Cloud API).
//
//  GET  → handshake de verificación con META_VERIFY_TOKEN (Meta lo llama una vez
//         al registrar el webhook). Devuelve hub.challenge si el token coincide.
//
//  POST → mensajes entrantes. REGLAS:
//         - Valida X-Hub-Signature-256 (HMAC del BODY CRUDO con META_APP_SECRET).
//         - Responde 200 OK < 1s. La IA se procesa fuera del request (lib/queue).
//         - La resolución de tenant + descifrado de secretos va en el trabajo de
//           fondo para no gastar tiempo del request.

import crypto from "node:crypto";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/queue";
import { getTenantByPhoneNumberId } from "@/lib/tenant";
import { processInboundMessage } from "@/lib/ai/worker";
import {
  extractFailedStatuses,
  extractInboundMessages,
  type WaWebhookBody,
} from "@/lib/whatsapp/meta";
import { logEvent } from "@/lib/ops/events";

// El worker hace debounce (~8s) + llamadas a Gemini dentro de after(); damos
// margen de ejecución a la invocación.
export const maxDuration = 60;

function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// GET: verificación del webhook (suscripción en el panel de Meta).
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.META_VERIFY_TOKEN && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new Response("forbidden", { status: 403 });
}

// POST: eventos de mensajes.
export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();

  // Firma: 'sha256=<hex>' del body crudo con el App Secret (global de la app).
  const header = req.headers.get("x-hub-signature-256") ?? "";
  const provided = header.startsWith("sha256=") ? header.slice("sha256=".length) : "";
  const expected = crypto
    .createHmac("sha256", env.META_APP_SECRET)
    .update(raw, "utf8")
    .digest("hex");
  if (!provided || !timingSafeEqualHex(expected, provided)) {
    return new Response("invalid signature", { status: 401 });
  }

  let body: WaWebhookBody;
  try {
    body = JSON.parse(raw) as WaWebhookBody;
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // Solo eventos de WhatsApp. Los statuses de entrega/lectura se ignoran,
  // EXCEPTO los failed: la Cloud API acepta el envío (wamid) aunque el número
  // no tenga WhatsApp o Meta decida no entregar (límite de marketing) — sin
  // esto el fallo es invisible (caso real: recordatorio de carrito que "salió"
  // pero nunca llegó, 2026-07-18).
  const inbound = extractInboundMessages(body);
  const failed = extractFailedStatuses(body);

  for (const { value, status } of failed) {
    const phoneNumberId = value.metadata?.phone_number_id;
    enqueue(async () => {
      const resolved = phoneNumberId ? await getTenantByPhoneNumberId(phoneNumberId) : null;
      await logEvent({
        kind: "wa_delivery_failure",
        severity: "warning",
        tenantId: resolved?.tenant.id ?? null,
        detail: {
          wa_message_id: status.id,
          recipient: status.recipient_id ?? null,
          errors: (status.errors ?? []).map((e) => ({
            code: e.code,
            title: e.title,
            message: e.message,
            details: e.error_data?.details,
          })),
        },
      });
    });
  }

  // Encolamos el trabajo pesado y respondemos 200 de inmediato (< 1s).
  for (const { value, message } of inbound) {
    const phoneNumberId = value.metadata?.phone_number_id;
    if (!phoneNumberId) continue;
    enqueue(async () => {
      const resolved = await getTenantByPhoneNumberId(phoneNumberId);
      if (!resolved) {
        console.error(`[meta webhook] tenant desconocido para phone_number_id=${phoneNumberId}`);
        return;
      }
      await processInboundMessage({
        tenant: resolved.tenant,
        secrets: resolved.secrets,
        value,
        message,
      });
    });
  }

  return new Response("ok", { status: 200 });
}
