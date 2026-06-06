// Creación de órdenes en Shopify (contraentrega / COD).
// Usa la mutación orderCreate (scope write_orders) con financialStatus PENDING
// (= pago pendiente = contraentrega). El total y los precios salen del catálogo
// en Supabase, NUNCA de la IA.

import { createAdminClient } from "../supabase/admin";
import { shopifyGraphQL, gidToNumericId, type ShopifyCreds } from "./client";

export type OrderItem = { producto_id: string; cantidad: number };
export type CustomerData = {
  nombre: string;
  telefono: string;
  direccion: string;
  ciudad: string;
};

export type CreateOrderResult =
  | {
      ok: true;
      shopify_order_id: string;
      order_name: string;
      subtotal: number;
      envio: number;
      total: number;
      pago: "contra_entrega";
    }
  | { ok: false; error: string };

const SHOP_CURRENCY = `{ shop { currencyCode } }`;

const ORDER_CREATE = `
mutation($order: OrderCreateOrderInput!) {
  orderCreate(order: $order) {
    order { id name totalPriceSet { shopMoney { amount currencyCode } } }
    userErrors { field message }
  }
}`;

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") || parts[0] || "" };
}

// Normaliza un teléfono colombiano a E.164 (+57...) para que Shopify lo acepte.
function normalizeCoPhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("57")) return "+" + digits;
  if (digits.length === 10) return "+57" + digits;
  return "+" + digits;
}

// Reglas de envío del tenant (mismas que la herramienta calcular_envio).
function shippingCost(
  shipping_rules: Record<string, unknown>,
  subtotal: number
): number {
  const freeOver = Number(shipping_rules.free_over ?? 150000);
  const flatFee = Number(shipping_rules.flat_fee ?? 15000);
  return subtotal >= freeOver ? 0 : flatFee;
}

export async function createCodOrder(params: {
  tenantId: string;
  creds: ShopifyCreds;
  shippingRules: Record<string, unknown>;
  conversationId?: string;
  items: OrderItem[];
  cliente: CustomerData;
}): Promise<CreateOrderResult> {
  const { tenantId, creds, shippingRules, conversationId, items, cliente } = params;
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "Sin items." };
  }
  const supabase = createAdminClient();

  // 1) Resolver variant id + precio desde el catálogo local (server-side).
  const lineItems: { variantId: string; quantity: number }[] = [];
  // Detalle por línea para persistir en order_items (métricas de producto).
  const resolvedItems: {
    shopifyId: string;
    title: string | null;
    unitPrice: number;
    quantity: number;
  }[] = [];
  let subtotal = 0;
  for (const it of items) {
    const { data: prod } = await supabase
      .from("products")
      .select("title, price, shopify_variant_id")
      .eq("tenant_id", tenantId)
      .eq("shopify_id", String(it.producto_id))
      .maybeSingle();
    if (!prod) return { ok: false, error: `Producto ${it.producto_id} no existe.` };
    if (!prod.shopify_variant_id) {
      return { ok: false, error: `Producto ${it.producto_id} sin variante sincronizada.` };
    }
    const cantidad = Math.max(1, Number(it.cantidad) || 1);
    const unitPrice = Number(prod.price ?? 0);
    subtotal += unitPrice * cantidad;
    lineItems.push({ variantId: prod.shopify_variant_id, quantity: cantidad });
    resolvedItems.push({
      shopifyId: String(it.producto_id),
      title: prod.title,
      unitPrice,
      quantity: cantidad,
    });
  }
  if (!cliente.direccion?.trim()) {
    return { ok: false, error: "Falta la dirección de entrega del cliente." };
  }
  const envio = shippingCost(shippingRules, subtotal);
  const { first, last } = splitName(cliente.nombre);
  const phone = normalizeCoPhone(cliente.telefono);

  // 2) Moneda de la tienda (para la línea de envío).
  const shopData = await shopifyGraphQL<{ shop: { currencyCode: string } }>(
    creds,
    SHOP_CURRENCY
  );
  const currencyCode = shopData.shop.currencyCode;

  // 3) Crear la orden con pago pendiente (contraentrega).
  const order = {
    lineItems,
    financialStatus: "PENDING",
    phone,
    shippingLines: [
      { title: "Envío", priceSet: { shopMoney: { amount: envio.toFixed(2), currencyCode } } },
    ],
    shippingAddress: {
      firstName: first,
      lastName: last,
      address1: cliente.direccion,
      city: cliente.ciudad,
      phone,
      country: "Colombia",
    },
    tags: ["nitro-bot", "cod"],
    note: "Pedido creado por Nitro Bot — pago contra entrega.",
  };

  const res = await shopifyGraphQL<{
    orderCreate: {
      order: {
        id: string;
        name: string;
        totalPriceSet: { shopMoney: { amount: string } };
      } | null;
      userErrors: { message: string }[];
    };
  }>(creds, ORDER_CREATE, { order });

  if (res.orderCreate.userErrors.length || !res.orderCreate.order) {
    return {
      ok: false,
      error: res.orderCreate.userErrors.map((e) => e.message).join("; ") || "orderCreate falló",
    };
  }

  const created = res.orderCreate.order;
  const total = Number(created.totalPriceSet.shopMoney.amount);
  const shopifyOrderId = gidToNumericId(created.id);

  // 4) Registrar cliente (CRM) y orden (trazabilidad) en Supabase.
  await supabase.from("customers").upsert(
    { tenant_id: tenantId, phone, name: cliente.nombre, city: cliente.ciudad },
    { onConflict: "tenant_id,phone" }
  );
  const { data: orderRow } = await supabase
    .from("orders")
    .insert({
      tenant_id: tenantId,
      conversation_id: conversationId ?? null,
      shopify_order_id: shopifyOrderId,
      total,
      channel: "bot",
    })
    .select("id")
    .single();

  // Líneas de la orden para métricas de "productos más vendidos".
  if (orderRow) {
    await supabase.from("order_items").insert(
      resolvedItems.map((ri) => ({
        tenant_id: tenantId,
        order_id: orderRow.id,
        shopify_product_id: ri.shopifyId,
        title: ri.title,
        quantity: ri.quantity,
        unit_price: ri.unitPrice,
      }))
    );
  }

  return {
    ok: true,
    shopify_order_id: shopifyOrderId,
    order_name: created.name,
    subtotal,
    envio,
    total,
    pago: "contra_entrega",
  };
}
