// Webhook de Shopify: catálogo/inventario.
// - Valida el HMAC sobre el BODY CRUDO (no el JSON parseado) usando el
//   shopify_webhook_secret (API secret) del tenant.
// - Resuelve el tenant por el dominio de la tienda.
// - Responde 200 rápido y procesa el sync en segundo plano con after().

import crypto from "node:crypto";
import { after } from "next/server";
import { getTenantByShopDomain } from "@/lib/tenant";
import { syncProductById, deleteProductById } from "@/lib/shopify/sync";
import {
  processCheckoutWebhook,
  processOrderWebhook,
  type ShopifyCheckoutPayload,
  type ShopifyOrderPayload,
} from "@/lib/carts/checkouts";

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256") ?? "";
  const shopDomain = req.headers.get("x-shopify-shop-domain") ?? "";
  const topic = req.headers.get("x-shopify-topic") ?? "";

  if (!shopDomain) return new Response("missing shop domain", { status: 400 });

  const resolved = await getTenantByShopDomain(shopDomain);
  if (!resolved?.secrets.shopify_webhook_secret || !resolved.secrets.shopify_access_token) {
    // Tenant desconocido o sin credenciales: no revelar detalles.
    return new Response("unauthorized", { status: 401 });
  }

  const digest = crypto
    .createHmac("sha256", resolved.secrets.shopify_webhook_secret)
    .update(raw, "utf8")
    .digest("base64");
  if (!timingSafeEqual(digest, hmacHeader)) {
    return new Response("invalid hmac", { status: 401 });
  }

  const tenant = resolved.tenant;
  const creds = {
    domain: tenant.shopify_domain!,
    accessToken: resolved.secrets.shopify_access_token,
  };
  const payload = JSON.parse(raw) as { id?: number | string };
  const numericId = payload.id != null ? String(payload.id) : null;

  // 200 OK ya; el trabajo pesado va en after().
  after(async () => {
    try {
      // Carritos abandonados (Spec 13): ingesta de checkouts y cierre por orden.
      if (topic === "checkouts/create" || topic === "checkouts/update") {
        await processCheckoutWebhook(tenant, payload as ShopifyCheckoutPayload);
        return;
      }
      if (topic === "orders/create") {
        await processOrderWebhook(tenant, payload as ShopifyOrderPayload);
        return;
      }

      // Catálogo: fetch + embedding + upsert del producto.
      if (!numericId) return;
      if (topic === "products/delete") {
        await deleteProductById(tenant.id, numericId);
      } else {
        // products/create | products/update | inventory -> re-sincroniza el producto
        await syncProductById(tenant.id, creds, numericId);
      }
    } catch (e) {
      console.error(`[shopify webhook] ${topic} ${numericId} falló:`, e);
    }
  });

  return new Response("ok", { status: 200 });
}
