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

  // Retención de event_log (observabilidad): todo > 90 días fuera; lo de
  // severidad 'info' (trazas de herramientas) > 30 días fuera. Best-effort:
  // un fallo aquí no invalida el reseteo de contadores.
  const days = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
  const { error: purgeOld } = await supabase
    .from("event_log")
    .delete()
    .lt("created_at", days(90));
  const { error: purgeInfo } = await supabase
    .from("event_log")
    .delete()
    .eq("severity", "info")
    .lt("created_at", days(30));
  if (purgeOld || purgeInfo) {
    console.error(
      "[cron reset-counters] retención de event_log falló:",
      purgeOld?.message ?? purgeInfo?.message
    );
  }

  return Response.json({ ok: true, reset: data ?? 0 });
}
