// Carga inicial del catálogo de un tenant. Wrapper delgado sobre
// lib/provisioning/catalog.ts (resuelve por slug, no por dominio).
//
//   SEED_TENANT_SLUG=elegance-dev npx tsx scripts/backfill-catalog.ts
//   (compat) SEED_SHOP_DOMAIN sigue aceptándose como referencia humana.

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { runBackfill } from "../lib/provisioning/catalog";

const SLUG = process.env.SEED_TENANT_SLUG ?? "elegance-dev";

async function main() {
  console.log(`Sincronizando catálogo del tenant "${SLUG}" ...`);
  const n = await runBackfill(SLUG);
  console.log(`✅ ${n} producto(s) sincronizado(s) con embedding.`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
