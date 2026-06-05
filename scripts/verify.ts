// Suite de verificación de Nitro Bot (segura de correr en cualquier momento).
// Read-only sobre datos reales + un test de fuga RLS con usuario desechable que
// se elimina al final. No muta datos del tenant. Sale con código !=0 si algo falla.
//
//   npm run verify

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../lib/supabase/admin";
import { getTenantBySlug } from "../lib/tenant";
import { searchProducts } from "../lib/ai/rag";

const SLUG = process.env.SEED_TENANT_SLUG ?? "elegance-dev";
let failures = 0;

async function check(name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    failures++;
    console.log(`❌ ${name} — ${(e as Error).message}`);
  }
}

async function main() {
  const admin = createAdminClient();

  await check("tenant + secretos descifran", async () => {
    const r = await getTenantBySlug(SLUG);
    if (!r) throw new Error("tenant no encontrado");
    if (!r.secrets.shopify_access_token) throw new Error("sin shopify token");
    if (!r.secrets.wa_access_token) throw new Error("sin wa token");
    if (!r.tenant.wa_phone_number_id) throw new Error("sin wa_phone_number_id");
    return `${r.tenant.name}`;
  });

  await check("RAG devuelve productos", async () => {
    const r = await getTenantBySlug(SLUG);
    const hits = await searchProducts(r!.tenant.id, "algo para una ocasión especial", 3);
    if (hits.length === 0) throw new Error("0 resultados");
    return `${hits.length} hits (top: ${hits[0].title})`;
  });

  await check("función de reseteo de contador existe", async () => {
    const { data, error } = await admin.rpc("reset_stale_message_counters");
    if (error) throw new Error(error.message);
    return `reseteó ${data ?? 0} tenants (0 = nada vencido)`;
  });

  await check("RLS aísla por tenant (usuario desechable)", async () => {
    const { data: tenant } = await admin
      .from("tenants")
      .select("id")
      .eq("slug", SLUG)
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
      await admin.from("app_users").upsert({ id: userId, tenant_id: tenant!.id, email, role: "admin" });
      const anon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { error: sErr } = await anon.auth.signInWithPassword({ email, password });
      if (sErr) throw new Error(`sign-in: ${sErr.message}`);
      const { data: tenants } = await anon.from("tenants").select("id");
      if ((tenants?.length ?? 0) !== 1) throw new Error(`ve ${tenants?.length} tenants (esperado 1)`);
      const { data: secrets } = await anon.from("tenant_secrets").select("tenant_id");
      if ((secrets?.length ?? 0) !== 0) throw new Error("FUGA: tenant_secrets visible");
      return "1 tenant visible, secrets ocultos";
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  console.log(failures === 0 ? "\n✅ Todo OK" : `\n❌ ${failures} fallo(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Error fatal:", e.message);
  process.exit(1);
});
