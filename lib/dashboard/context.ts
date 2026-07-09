// Contexto del dashboard: resuelve el usuario autenticado, su fila en app_users
// y su tenant. Todo vía el cliente SSR (RLS), así que el usuario solo puede leer
// SU tenant: current_tenant_id() filtra automáticamente. Si algo falta, redirige
// a /login (p.ej. un usuario de Auth sin app_users asignado).

import { redirect } from "next/navigation";
import { createServerSupabase, getAuthUser } from "@/lib/supabase/server";

export type DashboardTenant = {
  id: string;
  name: string;
  slug: string | null;
  system_prompt: string | null;
  ai_model: string;
  message_limit: number;
  current_month_messages: number;
  counter_period_start: string;
  modules: Record<string, boolean>;
  is_active: boolean;
  logo_url: string | null;
  brand_color: string | null;
};

export async function getDashboardContext() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const supabase = await createServerSupabase();

  const { data: appUser } = await supabase
    .from("app_users")
    .select("tenant_id, email, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!appUser) redirect("/login");

  const { data: tenant } = await supabase
    .from("tenants")
    .select(
      "id, name, slug, system_prompt, ai_model, message_limit, current_month_messages, counter_period_start, modules, is_active, logo_url, brand_color"
    )
    .eq("id", appUser.tenant_id)
    .maybeSingle();
  if (!tenant) redirect("/login");

  return {
    user,
    role: appUser.role as "agent" | "admin",
    tenant: tenant as DashboardTenant,
    supabase,
  };
}
