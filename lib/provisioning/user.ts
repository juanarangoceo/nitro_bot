// Alta (idempotente) de un usuario del dashboard para un tenant: usuario de
// Supabase Auth + fila en app_users (ata el usuario a su tenant para RLS).
// Compartido por scripts/seed-dashboard-user.ts y el panel.

import { createAdminClient } from "../supabase/admin";

export type SeedUserInput = {
  slug: string;
  email: string;
  password: string;
  role?: "admin" | "agent";
  name?: string;
};

type AdminClient = ReturnType<typeof createAdminClient>;

async function findUserIdByEmail(
  supabase: AdminClient,
  email: string
): Promise<string | null> {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`listUsers falló: ${error.message}`);
  return (
    data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null
  );
}

export async function seedDashboardUser(
  input: SeedUserInput
): Promise<{ userId: string; tenantId: string; reused: boolean }> {
  const supabase = createAdminClient();
  const role = input.role ?? "admin";

  const { data: tenant, error: tErr } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", input.slug)
    .maybeSingle();
  if (tErr) throw new Error(`No se pudo leer el tenant: ${tErr.message}`);
  if (!tenant) throw new Error(`No existe tenant con slug "${input.slug}".`);

  let userId: string;
  let reused = false;
  const { data: created, error: cErr } = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (cErr) {
    const existing = await findUserIdByEmail(supabase, input.email);
    if (!existing) throw new Error(`createUser falló: ${cErr.message}`);
    userId = existing;
    reused = true;
    await supabase.auth.admin.updateUserById(userId, { password: input.password });
  } else {
    userId = created.user.id;
  }

  const { error: aErr } = await supabase
    .from("app_users")
    .upsert(
      {
        id: userId,
        tenant_id: tenant.id,
        email: input.email,
        role,
        // Solo si viene: el re-seed no debe borrar un nombre ya configurado.
        ...(input.name ? { name: input.name } : {}),
      },
      { onConflict: "id" }
    );
  if (aErr) throw new Error(`Upsert app_users falló: ${aErr.message}`);

  return { userId, tenantId: tenant.id, reused };
}
