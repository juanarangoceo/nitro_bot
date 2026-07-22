// Carritos abandonados — lado de INGESTA (webhooks de Shopify).
// checkouts/create|update upsertean el checkout (idempotencia por
// (tenant_id, checkout_token)); orders/create y un checkouts/update con
// completed_at lo cierran (recovered/cancelled). Todo corre en after() del
// webhook (nunca en el request) y es best-effort: un fallo aquí jamás afecta
// el sync de catálogo ni la respuesta 200 a Shopify.
//
// Estados SOLO hacia adelante: nunca se retrocede ni se reabre un terminal.

import { createAdminClient } from "../supabase/admin";
import { logEvent } from "../ops/events";
import { normalizeCoPhone } from "../shopify/orders";
import type { Tenant } from "../tenant";

const ACTIVE_STATUSES = ["pending", "reminded_1", "reminded_2"] as const;

// Subset del payload REST de checkouts/create|update que usamos.
export type ShopifyCheckoutPayload = {
  id?: number | string;
  token?: string;
  abandoned_checkout_url?: string;
  total_price?: string | number;
  currency?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  phone?: string | null;
  customer?: {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
  } | null;
  billing_address?: { name?: string | null; phone?: string | null } | null;
  shipping_address?: { name?: string | null; phone?: string | null } | null;
  line_items?: { title?: string; quantity?: number; price?: string | number }[];
};

// Subset del payload REST de orders/create.
export type ShopifyOrderPayload = {
  id?: number | string;
  checkout_token?: string | null;
  phone?: string | null;
  customer?: { phone?: string | null } | null;
  billing_address?: { phone?: string | null } | null;
  shipping_address?: { phone?: string | null } | null;
};

// El teléfono puede venir en 4 lugares según cómo llenó el checkout el
// comprador. Sin teléfono no hay canal: el checkout se ignora.
function extractPhone(p: {
  phone?: string | null;
  customer?: { phone?: string | null } | null;
  billing_address?: { phone?: string | null } | null;
  shipping_address?: { phone?: string | null } | null;
}): string | null {
  const raw =
    p.phone ?? p.customer?.phone ?? p.shipping_address?.phone ?? p.billing_address?.phone;
  if (!raw) return null;
  const e164 = normalizeCoPhone(String(raw));
  // Un E.164 real tiene al menos ~10 dígitos; basura corta no sirve de destino.
  return e164.replace(/\D/g, "").length >= 10 ? e164 : null;
}

function extractName(p: ShopifyCheckoutPayload): string | null {
  const fromCustomer = [p.customer?.first_name, p.customer?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return fromCustomer || p.shipping_address?.name?.trim() || p.billing_address?.name?.trim() || null;
}

// Upsert del checkout desde checkouts/create|update. Reglas:
// - Sin teléfono → se ignora (no hay canal de WhatsApp).
// - Cada update reprograma el reloj (last_activity_at): los recordatorios
//   cuentan desde la última actividad, no desde la creación.
// - Un update con completed_at cierra el checkout (el comprador compró).
// - Jamás toca un checkout en estado terminal.
export async function processCheckoutWebhook(
  tenant: Pick<Tenant, "id" | "abandoned_carts_enabled">,
  payload: ShopifyCheckoutPayload
): Promise<void> {
  if (tenant.abandoned_carts_enabled !== true) return;
  const token = payload.token?.trim();
  if (!token) return;
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("abandoned_checkouts")
    .select("id, status, reminder_1_sent_at")
    .eq("tenant_id", tenant.id)
    .eq("checkout_token", token)
    .maybeSingle();

  // Checkout completado: cerrar si está activo (recovered si ya se le recordó,
  // cancelled si compró antes de cualquier recordatorio).
  if (payload.completed_at) {
    if (!existing || !ACTIVE_STATUSES.includes(existing.status as never)) return;
    await supabase
      .from("abandoned_checkouts")
      .update({
        status: existing.reminder_1_sent_at ? "recovered" : "cancelled",
        recovered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return;
  }

  if (existing && !ACTIVE_STATUSES.includes(existing.status as never)) return;

  const phone = extractPhone(payload);
  if (!phone) {
    // Sin teléfono no hay canal, pero la fuga debe poder medirse. Solo en la
    // primera vez (sin fila previa): los updates repetidos no re-loguean.
    if (!existing) {
      await logEvent({
        kind: "cart_reminder",
        severity: "info",
        tenantId: tenant.id,
        detail: { stage: "no_phone", token },
      });
    }
    return;
  }

  const lineItems = (payload.line_items ?? [])
    .slice(0, 25)
    .map((li) => ({
      title: (li.title ?? "").trim(),
      quantity: li.quantity ?? 1,
      price: li.price ?? null,
    }));

  const row = {
    tenant_id: tenant.id,
    checkout_token: token,
    shopify_checkout_id: payload.id != null ? String(payload.id) : null,
    phone,
    customer_name: extractName(payload),
    line_items: lineItems,
    total_price: payload.total_price != null ? Number(payload.total_price) : null,
    currency: payload.currency ?? null,
    abandoned_checkout_url: payload.abandoned_checkout_url ?? null,
    last_activity_at: payload.updated_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("abandoned_checkouts")
    .upsert(row, { onConflict: "tenant_id,checkout_token", ignoreDuplicates: false });
  if (error) {
    await logEvent({
      kind: "cart_reminder",
      severity: "warning",
      tenantId: tenant.id,
      detail: { stage: "checkout_upsert", token, error: error.message },
    });
  }
}

// orders/create: cierra el checkout que originó la orden. Primero por
// checkout_token exacto; si la orden no lo trae, por teléfono contra el
// checkout activo más reciente de los últimos 7 días (regla de atribución).
// También cubre las ventas cerradas por el BOT (orderCreate dispara este
// mismo webhook), así el asesor que remata la venta cuenta como recuperación.
export async function processOrderWebhook(
  tenant: Pick<Tenant, "id" | "abandoned_carts_enabled">,
  payload: ShopifyOrderPayload
): Promise<void> {
  if (tenant.abandoned_carts_enabled !== true) return;
  const supabase = createAdminClient();
  const orderId = payload.id != null ? String(payload.id) : null;

  let match: { id: string; reminder_1_sent_at: string | null } | null = null;

  const token = payload.checkout_token?.trim();
  if (token) {
    const { data } = await supabase
      .from("abandoned_checkouts")
      .select("id, reminder_1_sent_at")
      .eq("tenant_id", tenant.id)
      .eq("checkout_token", token)
      .in("status", ACTIVE_STATUSES as unknown as string[])
      .maybeSingle();
    match = data ?? null;
  }

  if (!match) {
    const phone = extractPhone(payload);
    if (!phone) return;
    const since = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
    const { data } = await supabase
      .from("abandoned_checkouts")
      .select("id, reminder_1_sent_at")
      .eq("tenant_id", tenant.id)
      .eq("phone", phone)
      .in("status", ACTIVE_STATUSES as unknown as string[])
      .gte("created_at", since)
      .order("last_activity_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    match = data ?? null;
  }

  if (!match) return;
  await supabase
    .from("abandoned_checkouts")
    .update({
      status: match.reminder_1_sent_at ? "recovered" : "cancelled",
      recovered_shopify_order_id: orderId,
      recovered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", match.id);
}
