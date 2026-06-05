// Carga las credenciales de WhatsApp (Meta Cloud API) en un tenant existente.
// El access token se guarda CIFRADO en tenant_secrets; el phone_number_id y el
// business_account_id no son secretos (se usan para enrutar webhooks) y van en
// la tabla tenants.
//
// Uso (valores desde el panel de Meta → WhatsApp → API Setup):
//   SEED_WA_PHONE_NUMBER_ID=123456789012345 \
//   SEED_WA_TOKEN=EAAG... \
//   SEED_WA_BUSINESS_ACCOUNT_ID=987654321098765 \   # opcional
//   SEED_TENANT_SLUG=elegance-dev \                  # opcional (default)
//   npm run seed:wa

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createAdminClient } from "../lib/supabase/admin";
import { encryptSecret } from "../lib/crypto";

const PHONE_NUMBER_ID = process.env.SEED_WA_PHONE_NUMBER_ID;
const WA_TOKEN = process.env.SEED_WA_TOKEN;
const BUSINESS_ACCOUNT_ID = process.env.SEED_WA_BUSINESS_ACCOUNT_ID ?? null;
const SLUG = process.env.SEED_TENANT_SLUG ?? "elegance-dev";

async function main() {
  if (!PHONE_NUMBER_ID || !WA_TOKEN) {
    throw new Error(
      "Faltan SEED_WA_PHONE_NUMBER_ID / SEED_WA_TOKEN en el entorno"
    );
  }
  const supabase = createAdminClient();

  // 1) Localizar el tenant por slug.
  const { data: tenant, error: tErr } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("slug", SLUG)
    .maybeSingle();
  if (tErr) throw new Error(`No se pudo leer el tenant: ${tErr.message}`);
  if (!tenant) throw new Error(`No existe un tenant con slug "${SLUG}". Corre seed:tenant primero.`);

  // 2) Identificadores de enrutamiento (no secretos) en tenants.
  const { error: uErr } = await supabase
    .from("tenants")
    .update({
      wa_phone_number_id: PHONE_NUMBER_ID,
      wa_business_account_id: BUSINESS_ACCOUNT_ID,
    })
    .eq("id", tenant.id);
  if (uErr) throw new Error(`Update de tenant falló: ${uErr.message}`);

  // 3) Access token CIFRADO en tenant_secrets (preserva los secretos de Shopify).
  const { error: sErr } = await supabase.from("tenant_secrets").upsert(
    {
      tenant_id: tenant.id,
      wa_access_token: encryptSecret(WA_TOKEN),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" }
  );
  if (sErr) throw new Error(`Upsert de secretos falló: ${sErr.message}`);

  console.log("✅ Credenciales WhatsApp cargadas:");
  console.log(`   tenant:          ${tenant.name} (${tenant.id})`);
  console.log(`   phone_number_id: ${PHONE_NUMBER_ID}`);
  console.log(`   business_acct:   ${BUSINESS_ACCOUNT_ID ?? "(no provisto)"}`);
  console.log("   wa_access_token: cifrado en tenant_secrets ✅");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
