// Carga inicial del catálogo de un tenant: trae todos los productos de Shopify,
// genera embeddings y los upsertea en products. Usa el mismo código que el
// webhook (lib/shopify/sync). Idempotente: se puede correr varias veces.
//
//   SEED_SHOP_DOMAIN=xxx.myshopify.com npx tsx scripts/backfill-catalog.ts

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getTenantByShopDomain } from "../lib/tenant";
import { backfillCatalog } from "../lib/shopify/sync";

const SHOP_DOMAIN = process.env.SEED_SHOP_DOMAIN;

async function main() {
  if (!SHOP_DOMAIN) throw new Error("Falta SEED_SHOP_DOMAIN en el entorno");

  const resolved = await getTenantByShopDomain(SHOP_DOMAIN);
  if (!resolved) throw new Error(`No hay tenant para ${SHOP_DOMAIN}. Corre seed-tenant primero.`);
  if (!resolved.secrets.shopify_access_token) {
    throw new Error("El tenant no tiene shopify_access_token cargado.");
  }

  console.log(`Sincronizando catálogo de ${resolved.tenant.name} ...`);
  const n = await backfillCatalog(resolved.tenant.id, {
    domain: resolved.tenant.shopify_domain!,
    accessToken: resolved.secrets.shopify_access_token,
  });
  console.log(`✅ ${n} producto(s) sincronizado(s) con embedding.`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
