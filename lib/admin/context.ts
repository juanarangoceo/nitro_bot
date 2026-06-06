// Contexto del Panel de Plataforma (/admin). A DIFERENCIA del dashboard del
// cliente, NO se apoya en RLS: el super-admin trasciende el aislamiento entre
// tenants por diseño. La autorización es EXPLÍCITA y corre con service_role.
//
// Regla de seguridad (no negociable): verificar super-admin en CADA entrada a
// /admin Y en CADA Server Action de plataforma (no confiar en el proxy).

import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type PlatformAdminContext = {
  user: { id: string; email?: string };
  adminId: string;
  admin: ReturnType<typeof createAdminClient>;
};

export async function getPlatformAdminContext(): Promise<PlatformAdminContext> {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_admins")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  // No es super-admin → nunca exponer datos de plataforma. Lo mandamos al
  // dashboard del cliente (si tampoco tiene tenant, allí se redirige a /login).
  if (!data) redirect("/dashboard");

  return { user: { id: user.id, email: user.email }, adminId: user.id, admin };
}

// Verifica super-admin y devuelve el cliente service_role. Para usar al inicio
// de las Server Actions de plataforma.
export async function requirePlatformAdmin() {
  return getPlatformAdminContext();
}

// Chequeo booleano de super-admin por id (para el ruteo post-login). No
// redirige; solo consulta platform_admins con service_role.
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_admins")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  return !!data;
}

// Registra una acción de plataforma en audit_log (sin secretos en claro).
export async function logAudit(
  admin: ReturnType<typeof createAdminClient>,
  params: { adminId: string; action: string; tenantId?: string | null; detail?: unknown }
): Promise<void> {
  await admin.from("audit_log").insert({
    admin_id: params.adminId,
    action: params.action,
    tenant_id: params.tenantId ?? null,
    detail: (params.detail ?? null) as never,
  });
}
