// Alta (idempotente) del PRIMER super-admin de la plataforma. No hay UI para
// crear el primero: este script crea/reutiliza el usuario de Supabase Auth e
// inserta su fila en platform_admins (tabla SEPARADA de app_users).
//
// Uso:
//   SEED_ADMIN_EMAIL=juan@nitroecom.co \
//   SEED_ADMIN_PASSWORD='unaClaveFuerte' \
//   npm run seed:platform-admin

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createAdminClient } from "../lib/supabase/admin";

const EMAIL = process.env.SEED_ADMIN_EMAIL;
const PASSWORD = process.env.SEED_ADMIN_PASSWORD;

async function findUserIdByEmail(
  supabase: ReturnType<typeof createAdminClient>,
  email: string
): Promise<string | null> {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`listUsers falló: ${error.message}`);
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    throw new Error("Faltan SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD en el entorno");
  }
  const supabase = createAdminClient();

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
    await supabase.auth.admin.updateUserById(userId, { password: PASSWORD });
    console.log("ℹ️  usuario ya existía; contraseña actualizada.");
  } else {
    userId = created.user.id;
  }

  const { error: aErr } = await supabase
    .from("platform_admins")
    .upsert({ id: userId, email: EMAIL }, { onConflict: "id" });
  if (aErr) throw new Error(`Upsert platform_admins falló: ${aErr.message}`);

  console.log("✅ Super-admin listo:");
  console.log(`   email: ${EMAIL}`);
  console.log(`   id:    ${userId}`);
  console.log("   → inicia sesión y entrarás a /admin");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
