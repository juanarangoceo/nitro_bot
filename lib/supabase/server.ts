// Cliente Supabase para el SERVIDOR del dashboard (Server Components, Server
// Actions, Route Handlers). Usa la anon key + cookies de sesión, por lo que las
// consultas corren como el usuario AUTENTICADO y respetan RLS (cada quien ve solo
// su tenant vía current_tenant_id()). NO confundir con createAdminClient (service
// role, ignora RLS) que es solo para webhooks/worker.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "../env";

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Llamado desde un Server Component (no puede escribir cookies).
          // El refresco de sesión lo hace proxy.ts; aquí es seguro ignorarlo.
        }
      },
    },
  });
}

// Devuelve el usuario autenticado o null. Usar getUser() (valida contra el
// servidor de Auth), nunca getSession() para decisiones de autorización.
export async function getAuthUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
