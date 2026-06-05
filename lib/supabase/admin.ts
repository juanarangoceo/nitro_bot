// Cliente Supabase con service_role: ignora RLS. SOLO para rutas server-side
// (webhooks, worker de IA, sync de Shopify). Nunca exponer al navegador.
// El tenant_id se resuelve y filtra explícitamente en cada operación.

import { createClient } from "@supabase/supabase-js";
import { env } from "../env";

export function createAdminClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
