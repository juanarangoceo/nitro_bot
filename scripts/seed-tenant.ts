// Alta (idempotente) del tenant Elegance (dev) con sus credenciales cifradas.
// Wrapper delgado sobre lib/provisioning/tenant.ts (CLI y panel comparten lógica).
//
// Uso (las credenciales se pasan por entorno, NO se hardcodean):
//   SEED_SHOP_DOMAIN=xxx.myshopify.com \
//   SEED_SHOP_TOKEN=shpat_... \
//   SEED_SHOP_SECRET=shpss_... \
//   npm run seed:tenant

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { upsertTenant } from "../lib/provisioning/tenant";

const SHOP_DOMAIN = process.env.SEED_SHOP_DOMAIN;
const SHOP_TOKEN = process.env.SEED_SHOP_TOKEN;
const SHOP_SECRET = process.env.SEED_SHOP_SECRET;
const SLUG = process.env.SEED_TENANT_SLUG ?? "elegance-dev";

const SYSTEM_PROMPT = `Eres el asesor virtual de Elegance Colombia, una tienda de moda.
Hablas en español (Colombia), con un tono cercano, cálido y profesional.
Tu objetivo es vender: diagnosticas lo que busca el cliente, recomiendas
productos del catálogo real, manejas objeciones y cierras el pedido tomando
los datos de envío. Nunca inventes precios ni descuentos: usa solo la
información del catálogo. Si no puedes resolver algo (reclamo, pedido fuera
de catálogo o el cliente pide un humano), escala a un agente.`;

async function main() {
  if (!SHOP_DOMAIN || !SHOP_TOKEN || !SHOP_SECRET) {
    throw new Error(
      "Faltan SEED_SHOP_DOMAIN / SEED_SHOP_TOKEN / SEED_SHOP_SECRET en el entorno"
    );
  }
  const tenant = await upsertTenant({
    slug: SLUG,
    name: "Elegance Colombia (dev)",
    shopifyDomain: SHOP_DOMAIN,
    shopifyAccessToken: SHOP_TOKEN,
    shopifyApiSecret: SHOP_SECRET,
    systemPrompt: SYSTEM_PROMPT,
  });

  console.log("✅ Tenant listo:");
  console.log(`   id:     ${tenant.id}`);
  console.log(`   nombre: ${tenant.name}`);
  console.log(`   shopify: ${tenant.shopify_domain}`);
  console.log("   credenciales: cifradas en tenant_secrets ✅");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
