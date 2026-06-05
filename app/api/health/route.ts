// Health check para observabilidad/uptime. Verifica que la app responde y que la
// base de datos es alcanzable. No expone datos sensibles.

import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(): Promise<Response> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("tenants")
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    return Response.json({ ok: true, db: "up", ts: new Date().toISOString() });
  } catch (e) {
    return Response.json(
      { ok: false, db: "down", error: (e as Error).message },
      { status: 503 }
    );
  }
}
