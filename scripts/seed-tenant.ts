// Alta (idempotente) del tenant Elegance (dev) con sus credenciales cifradas.
// Onboarding manual: Nitro Bot es un SaaS privado, no hay registro público.
//
// Uso (las credenciales se pasan por entorno, NO se hardcodean):
//   SEED_SHOP_DOMAIN=xxx.myshopify.com \
//   SEED_SHOP_TOKEN=shpat_... \
//   SEED_SHOP_SECRET=shpss_... \
//   npx tsx scripts/seed-tenant.ts

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createAdminClient } from "../lib/supabase/admin";
import { encryptSecret } from "../lib/crypto";

const SHOP_DOMAIN = process.env.SEED_SHOP_DOMAIN;
const SHOP_TOKEN = process.env.SEED_SHOP_TOKEN;
const SHOP_SECRET = process.env.SEED_SHOP_SECRET;

const SLUG = "elegance-dev";

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
  const supabase = createAdminClient();

  // 1) Upsert del tenant por slug.
  const { data: tenant, error: tErr } = await supabase
    .from("tenants")
    .upsert(
      {
        slug: SLUG,
        name: "Elegance Colombia (dev)",
        shopify_domain: SHOP_DOMAIN,
        system_prompt: SYSTEM_PROMPT,
        is_active: true,
      },
      { onConflict: "slug" }
    )
    .select("id, name, shopify_domain")
    .single();
  if (tErr) throw new Error(`Upsert tenant falló: ${tErr.message}`);

  // 2) Upsert de credenciales cifradas.
  const { error: sErr } = await supabase.from("tenant_secrets").upsert(
    {
      tenant_id: tenant.id,
      shopify_access_token: encryptSecret(SHOP_TOKEN),
      shopify_webhook_secret: encryptSecret(SHOP_SECRET),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" }
  );
  if (sErr) throw new Error(`Upsert secretos falló: ${sErr.message}`);

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
