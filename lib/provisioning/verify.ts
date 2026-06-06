// Suite de verificación de un tenant, en forma de función reutilizable. Devuelve
// resultados ESTRUCTURADOS (no imprime) para que tanto el script CLI como el
// panel de plataforma los muestren. Read-only sobre datos reales + un test de
// fuga RLS con usuario desechable que se elimina al final.

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin";
import { getTenantBySlug } from "../tenant";
import { searchProducts } from "../ai/rag";

export type VerifyCheck = { name: string; ok: boolean; detail: string };
export type VerifyResult = { checks: VerifyCheck[]; ok: boolean };

async function run(
  name: string,
  fn: () => Promise<string>
): Promise<VerifyCheck> {
  try {
    const detail = await fn();
    return { name, ok: true, detail };
  } catch (e) {
    return { name, ok: false, detail: (e as Error).message };
  }
}

export async function runVerify(slug: string): Promise<VerifyResult> {
  const admin = createAdminClient();
  const checks: VerifyCheck[] = [];

  checks.push(
    await run("tenant + secretos descifran", async () => {
      const r = await getTenantBySlug(slug);
      if (!r) throw new Error("tenant no encontrado");
      if (!r.secrets.shopify_access_token) throw new Error("sin shopify token");
      if (!r.secrets.wa_access_token) throw new Error("sin wa token");
      if (!r.tenant.wa_phone_number_id) throw new Error("sin wa_phone_number_id");
      return r.tenant.name;
    })
  );

  checks.push(
    await run("RAG devuelve productos", async () => {
      const r = await getTenantBySlug(slug);
      if (!r) throw new Error("tenant no encontrado");
      const hits = await searchProducts(r.tenant.id, "algo para una ocasión especial", 3);
      if (hits.length === 0) throw new Error("0 resultados");
      return `${hits.length} hits (top: ${hits[0].title})`;
    })
  );

  checks.push(
    await run("función de reseteo de contador existe", async () => {
      const { data, error } = await admin.rpc("reset_stale_message_counters");
      if (error) throw new Error(error.message);
      return `reseteó ${data ?? 0} tenants (0 = nada vencido)`;
    })
  );

  checks.push(
    await run("RLS aísla por tenant (usuario desechable)", async () => {
      const { data: tenant } = await admin
        .from("tenants")
        .select("id")
        .eq("slug", slug)
        .single();
      const email = `verify-${Date.now()}@nitro.test`;
      const password = crypto.randomBytes(18).toString("base64");
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw new Error(error.message);
      const userId = created.user.id;
      try {
        await admin
          .from("app_users")
          .upsert({ id: userId, tenant_id: tenant!.id, email, role: "admin" });
        const anon = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
        const { error: sErr } = await anon.auth.signInWithPassword({ email, password });
        if (sErr) throw new Error(`sign-in: ${sErr.message}`);
        const { data: tenants } = await anon.from("tenants").select("id");
        if ((tenants?.length ?? 0) !== 1)
          throw new Error(`ve ${tenants?.length} tenants (esperado 1)`);
        const { data: secrets } = await anon.from("tenant_secrets").select("tenant_id");
        if ((secrets?.length ?? 0) !== 0) throw new Error("FUGA: tenant_secrets visible");
        return "1 tenant visible, secrets ocultos";
      } finally {
        await admin.auth.admin.deleteUser(userId);
      }
    })
  );

  return { checks, ok: checks.every((c) => c.ok) };
}
