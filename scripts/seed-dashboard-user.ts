// Crea (idempotente) un usuario del dashboard para un tenant: usuario de Supabase
// Auth + fila en app_users (que ata el usuario a su tenant para RLS).
// Onboarding manual: el admin de la agencia crea las cuentas.
//
// Uso:
//   SEED_USER_EMAIL=admin@elegance.co \
//   SEED_USER_PASSWORD='unaClaveFuerte' \
//   SEED_TENANT_SLUG=elegance-dev \           # opcional (default)
//   SEED_USER_ROLE=admin \                    # opcional: admin|agent (default admin)
//   npm run seed:dashboard-user

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createAdminClient } from "../lib/supabase/admin";

const EMAIL = process.env.SEED_USER_EMAIL;
const PASSWORD = process.env.SEED_USER_PASSWORD;
const SLUG = process.env.SEED_TENANT_SLUG ?? "elegance-dev";
const ROLE = (process.env.SEED_USER_ROLE ?? "admin") as "admin" | "agent";

async function findUserIdByEmail(
  supabase: ReturnType<typeof createAdminClient>,
  email: string
): Promise<string | null> {
  // listUsers es paginado; para dev con pocos usuarios una página basta.
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`listUsers falló: ${error.message}`);
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    throw new Error("Faltan SEED_USER_EMAIL / SEED_USER_PASSWORD en el entorno");
  }
  const supabase = createAdminClient();

  // 1) Tenant.
  const { data: tenant, error: tErr } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("slug", SLUG)
    .maybeSingle();
  if (tErr) throw new Error(`No se pudo leer el tenant: ${tErr.message}`);
  if (!tenant) throw new Error(`No existe tenant con slug "${SLUG}".`);

  // 2) Usuario de Auth (crear o reutilizar).
  let userId: string;
  const { data: created, error: cErr } = await supabase.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (cErr) {
    const existing = await findUserIdByEmail(supabase, EMAIL);
    if (!existing) throw new Error(`createUser falló: ${cErr.message}`);
    userId = existing;
    // Asegura la contraseña conocida en re-ejecuciones.
    await supabase.auth.admin.updateUserById(userId, { password: PASSWORD });
    console.log("ℹ️  usuario ya existía; contraseña actualizada.");
  } else {
    userId = created.user.id;
  }

  // 3) app_users (ata usuario ↔ tenant para RLS).
  const { error: aErr } = await supabase
    .from("app_users")
    .upsert(
      { id: userId, tenant_id: tenant.id, email: EMAIL, role: ROLE },
      { onConflict: "id" }
    );
  if (aErr) throw new Error(`Upsert app_users falló: ${aErr.message}`);

  console.log("✅ Usuario de dashboard listo:");
  console.log(`   email:  ${EMAIL}`);
  console.log(`   tenant: ${tenant.name} (${tenant.id})`);
  console.log(`   role:   ${ROLE}`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
