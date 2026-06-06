// Carga las credenciales de WhatsApp (Meta Cloud API) en un tenant existente.
// Wrapper delgado sobre lib/provisioning/whatsapp.ts.
//
// Uso (valores desde el panel de Meta → WhatsApp → API Setup):
//   SEED_WA_PHONE_NUMBER_ID=123456789012345 \
//   SEED_WA_TOKEN=EAAG... \
//   SEED_WA_BUSINESS_ACCOUNT_ID=987654321098765 \   # opcional
//   SEED_TENANT_SLUG=elegance-dev \                  # opcional (default)
//   npm run seed:wa

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { seedWaCreds } from "../lib/provisioning/whatsapp";

const PHONE_NUMBER_ID = process.env.SEED_WA_PHONE_NUMBER_ID;
const WA_TOKEN = process.env.SEED_WA_TOKEN;
const BUSINESS_ACCOUNT_ID = process.env.SEED_WA_BUSINESS_ACCOUNT_ID ?? null;
const SLUG = process.env.SEED_TENANT_SLUG ?? "elegance-dev";

async function main() {
  if (!PHONE_NUMBER_ID || !WA_TOKEN) {
    throw new Error("Faltan SEED_WA_PHONE_NUMBER_ID / SEED_WA_TOKEN en el entorno");
  }
  const tenant = await seedWaCreds({
    slug: SLUG,
    phoneNumberId: PHONE_NUMBER_ID,
    waToken: WA_TOKEN,
    businessAccountId: BUSINESS_ACCOUNT_ID,
  });

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
