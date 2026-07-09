// Notificaciones por correo al equipo del cliente (Resend vía REST, sin SDK).
// Feature D de la spec de operación. SIEMPRE best-effort: un fallo de correo
// jamás tumba el flujo que lo origina; se registra en event_log (notify_failure).
// Sin RESEND_API_KEY/NOTIFY_FROM_EMAIL o sin tenants.notification_email → no-op.

import { env } from "../env";
import { createAdminClient } from "../supabase/admin";
import { logEvent } from "../ops/events";

const RESEND_URL = "https://api.resend.com/emails";

async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  tenantId?: string | null;
  conversationId?: string | null;
}): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.NOTIFY_FROM_EMAIL;
  if (!apiKey || !from) return false; // no configurado: silencio total

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        html: params.html,
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return true;
  } catch (e) {
    await logEvent({
      kind: "notify_failure",
      severity: "warning",
      tenantId: params.tenantId ?? null,
      conversationId: params.conversationId ?? null,
      detail: { channel: "email", to: params.to, error: (e as Error).message },
    });
    return false;
  }
}

// Datos del tenant necesarios para notificar. null si no hay correo configurado.
async function notificationTarget(
  tenantId: string
): Promise<{ email: string; tenantName: string } | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("tenants")
    .select("name, notification_email")
    .eq("id", tenantId)
    .maybeSingle();
  if (!data?.notification_email) return null;
  return { email: data.notification_email, tenantName: data.name };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Correo cuando un cliente NUEVO inicia conversación con el asesor.
// Nunca lanza: está en el camino del worker.
export async function notifyNewConversation(params: {
  tenantId: string;
  conversationId: string;
  customerPhone: string;
  contactName?: string | null;
}): Promise<void> {
  try {
    const target = await notificationTarget(params.tenantId);
    if (!target) return;

    const who = params.contactName
      ? `${esc(params.contactName)} (${esc(params.customerPhone)})`
      : esc(params.customerPhone);
    await sendEmail({
      to: target.email,
      subject: `Nueva conversación en ${target.tenantName}`,
      html: `
        <p>Un cliente nuevo escribió al asesor de <strong>${esc(target.tenantName)}</strong>:</p>
        <p style="font-size:16px"><strong>${who}</strong></p>
        <p>El asesor de IA ya lo está atendiendo. Puedes seguir la conversación en vivo desde tu dashboard (sección <em>Conversaciones</em>).</p>
      `,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });
  } catch (e) {
    console.error("[notify] nueva conversación:", e);
  }
}

// Correo cuando una conversación se escala a humano (ticket abierto):
// requiere acción del equipo de la tienda. Nunca lanza: está en el camino
// crítico del escalado.
export async function notifyTicketEscalated(params: {
  tenantId: string;
  conversationId: string;
  reason: string;
}): Promise<void> {
  try {
    const target = await notificationTarget(params.tenantId);
    if (!target) return;

    const supabase = createAdminClient();
    const { data: conv } = await supabase
      .from("conversations")
      .select("customer_phone")
      .eq("id", params.conversationId)
      .maybeSingle();

    await sendEmail({
      to: target.email,
      subject: `⚠️ Ticket: un cliente necesita atención humana — ${target.tenantName}`,
      html: `
        <p>El asesor de <strong>${esc(target.tenantName)}</strong> escaló una conversación a tu equipo.</p>
        <p><strong>Cliente:</strong> ${esc(conv?.customer_phone ?? "desconocido")}<br/>
        <strong>Motivo:</strong> ${esc(params.reason)}</p>
        <p>El bot dejó de responderle hasta que alguien atienda el ticket. Entra a tu dashboard (sección <em>Tickets</em>) para responderle por WhatsApp.</p>
      `,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
    });
  } catch (e) {
    console.error("[notify] ticket escalado:", e);
  }
}
