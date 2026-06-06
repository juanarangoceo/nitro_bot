// Crea (idempotente) un usuario del dashboard para un tenant. Wrapper delgado
// sobre lib/provisioning/user.ts.
//
// Uso:
//   SEED_USER_EMAIL=admin@elegance.co \
//   SEED_USER_PASSWORD='unaClaveFuerte' \
//   SEED_TENANT_SLUG=elegance-dev \           # opcional (default)
//   SEED_USER_ROLE=admin \                    # opcional: admin|agent (default admin)
//   npm run seed:dashboard-user

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { seedDashboardUser } from "../lib/provisioning/user";

const EMAIL = process.env.SEED_USER_EMAIL;
const PASSWORD = process.env.SEED_USER_PASSWORD;
const SLUG = process.env.SEED_TENANT_SLUG ?? "elegance-dev";
const ROLE = (process.env.SEED_USER_ROLE ?? "admin") as "admin" | "agent";

async function main() {
  if (!EMAIL || !PASSWORD) {
    throw new Error("Faltan SEED_USER_EMAIL / SEED_USER_PASSWORD en el entorno");
  }
  const r = await seedDashboardUser({ slug: SLUG, email: EMAIL, password: PASSWORD, role: ROLE });
  if (r.reused) console.log("ℹ️  usuario ya existía; contraseña actualizada.");

  console.log("✅ Usuario de dashboard listo:");
  console.log(`   email:  ${EMAIL}`);
  console.log(`   tenant: ${r.tenantId}`);
  console.log(`   role:   ${ROLE}`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
