// Cliente Supabase para el NAVEGADOR (Client Components del dashboard).
// Usa las vars públicas NEXT_PUBLIC_* (la anon key es pública por diseño; RLS
// protege los datos). Se usa para Realtime (tickets en vivo) y acciones del
// cliente. Las mutaciones sensibles van por Server Actions, no por aquí.

import { createBrowserClient } from "@supabase/ssr";

export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
