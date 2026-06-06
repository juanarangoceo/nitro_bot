// Suite de verificación de Nitro Bot. Wrapper delgado sobre
// lib/provisioning/verify.ts (read-only + test de fuga RLS con usuario
// desechable). Sale con código !=0 si algo falla.
//
//   SEED_TENANT_SLUG=elegance-dev npm run verify

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { runVerify } from "../lib/provisioning/verify";

const SLUG = process.env.SEED_TENANT_SLUG ?? "elegance-dev";

async function main() {
  const { checks, ok } = await runVerify(SLUG);
  for (const c of checks) {
    console.log(`${c.ok ? "✅" : "❌"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  console.log(ok ? "\n✅ Todo OK" : `\n❌ ${checks.filter((c) => !c.ok).length} fallo(s)`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("Error fatal:", e.message);
  process.exit(1);
});
