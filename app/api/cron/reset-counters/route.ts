// Cron de reseteo mensual del contador de consumo.
// Lo dispara Vercel Cron (ver vercel.json) el día 1 de cada mes. Vercel incluye
// el header Authorization: Bearer ${CRON_SECRET} cuando esa env var existe; lo
// validamos para que nadie más pueda invocarlo. Usa service_role (ignora RLS).

import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("reset_stale_message_counters");
  if (error) {
    console.error("[cron reset-counters] falló:", error.message);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true, reset: data ?? 0 });
}
