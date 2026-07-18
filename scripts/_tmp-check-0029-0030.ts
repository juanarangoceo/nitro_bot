// Verificación desechable de las migraciones 0029 (facturas manuales) y 0030
// (tickets asignados). Crea 2 tenants + 3 usuarios desechables, prueba RLS y
// FKs, y limpia todo al final.
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../lib/supabase/admin";

const admin = createAdminClient();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
}

async function makeUser(tenantId: string, role: "admin" | "agent") {
  const email = `chk-${crypto.randomBytes(5).toString("hex")}@nitro.test`;
  const password = crypto.randomBytes(18).toString("base64");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const { error: e2 } = await admin
    .from("app_users")
    .insert({ id: data.user.id, tenant_id: tenantId, email, role });
  if (e2) throw new Error(`app_users: ${e2.message}`);
  const client = createClient(URL, ANON);
  const { error: e3 } = await client.auth.signInWithPassword({ email, password });
  if (e3) throw new Error(`signIn: ${e3.message}`);
  return { id: data.user.id, client };
}

async function main() {
  const suffix = crypto.randomBytes(4).toString("hex");
  const { data: t1, error: te } = await admin
    .from("tenants")
    .insert({ slug: `chk1-${suffix}`, name: "Check T1" })
    .select("id")
    .single();
  if (te || !t1) throw new Error(`tenant1: ${te?.message}`);
  const { data: t2 } = await admin
    .from("tenants")
    .insert({ slug: `chk2-${suffix}`, name: "Check T2" })
    .select("id")
    .single();
  if (!t2) throw new Error("tenant2");

  const authIds: string[] = [];
  try {
    const adminU = await makeUser(t1.id, "admin");
    const agentA = await makeUser(t1.id, "agent");
    const agentB = await makeUser(t1.id, "agent");
    const otherU = await makeUser(t2.id, "agent");
    authIds.push(adminU.id, agentA.id, agentB.id, otherU.id);

    // ── 0029: facturas manuales ─────────────────────────────────────────────
    const { data: inv1, error: i1 } = await admin
      .from("invoices")
      .insert({
        tenant_id: t1.id,
        concept: "manual",
        description: "Implementación módulo X",
        amount: 250000,
        due_date: "2026-08-01",
        cycle_start: null,
      })
      .select("id")
      .single();
    check("manual: insert con cycle_start NULL", !i1 && !!inv1, i1?.message);

    const { error: i2 } = await admin.from("invoices").insert({
      tenant_id: t1.id,
      concept: "manual",
      description: "Otra implementación",
      amount: 100000,
      cycle_start: null,
    });
    check("manual: 2ª factura del mismo tenant no choca con unique index", !i2, i2?.message);

    const { data: seen } = await adminU.client
      .from("invoices")
      .select("id, concept, description, amount, status")
      .eq("concept", "manual");
    check(
      "manual: el cliente la ve por RLS con descripción",
      (seen ?? []).length === 2 && seen![0].description != null,
      JSON.stringify(seen?.[0])
    );

    const { data: crossInv } = await otherU.client.from("invoices").select("id");
    check("manual: otro tenant NO ve las facturas", (crossInv ?? []).length === 0);

    const { error: i3 } = await adminU.client
      .from("invoices")
      .insert({ tenant_id: t1.id, concept: "manual", amount: 1, cycle_start: null });
    check("manual: authenticated NO puede insertar facturas", !!i3, i3?.code);

    const { error: i4 } = await adminU.client
      .from("invoices")
      .update({ status: "pagada" })
      .eq("id", inv1!.id);
    const { data: stillPend } = await admin
      .from("invoices")
      .select("status")
      .eq("id", inv1!.id)
      .single();
    check(
      "manual: authenticated NO puede marcarla pagada",
      stillPend?.status === "pendiente",
      i4?.code ?? "0 filas"
    );

    // ── 0030: tickets asignados ─────────────────────────────────────────────
    const { data: conv, error: ce } = await admin
      .from("conversations")
      .insert({ tenant_id: t1.id, customer_phone: "+570000000099", status: "requires_human" })
      .select("id")
      .single();
    if (ce || !conv) throw new Error(`conversation: ${ce?.message}`);

    const mk = (assigned: string | null) =>
      admin
        .from("tickets")
        .insert({
          tenant_id: t1.id,
          conversation_id: conv.id,
          reason: "intervencion_manual",
          status: "open",
          assigned_to: assigned,
        })
        .select("id")
        .single();
    const { data: tkA } = await mk(agentA.id);
    const { data: tkB } = await mk(agentB.id);
    const { data: tkG } = await mk(null);
    if (!tkA || !tkB || !tkG) throw new Error("no se crearon los tickets");

    const { data: seesA } = await agentA.client.from("tickets").select("id");
    const idsA = new Set((seesA ?? []).map((r) => r.id));
    check(
      "asignado: agente ve el suyo + el general, NO el de otro",
      idsA.has(tkA.id) && idsA.has(tkG.id) && !idsA.has(tkB.id),
      `ve ${idsA.size}`
    );

    const { data: seesAdmin } = await adminU.client.from("tickets").select("id");
    check("asignado: admin del tenant ve los 3", (seesAdmin ?? []).length === 3);

    const { data: seesOther } = await otherU.client.from("tickets").select("id");
    check("asignado: otro tenant ve 0", (seesOther ?? []).length === 0);

    const { error: fkErr } = await admin.from("tickets").insert({
      tenant_id: t1.id,
      conversation_id: conv.id,
      reason: "intervencion_manual",
      status: "open",
      assigned_to: otherU.id,
    });
    check("asignado: FK compuesta bloquea usuario de otro tenant", fkErr?.code === "23503", fkErr?.code);

    // sendToTickets real: un usuario authenticated inserta con assigned_to.
    const { error: insAuth } = await agentA.client.from("tickets").insert({
      tenant_id: t1.id,
      conversation_id: conv.id,
      reason: "intervencion_manual",
      status: "open",
      assigned_to: agentB.id,
    });
    check("asignado: authenticated puede insertar ticket asignado", !insAuth, insAuth?.message);

    // on delete set null (assigned_to): borrar al usuario NO borra el ticket
    // ni toca tenant_id.
    await admin.from("app_users").delete().eq("id", agentB.id);
    const { data: afterDel } = await admin
      .from("tickets")
      .select("assigned_to, tenant_id")
      .eq("id", tkB.id)
      .single();
    check(
      "asignado: borrar el usuario deja el ticket general (tenant intacto)",
      afterDel?.assigned_to === null && afterDel?.tenant_id === t1.id,
      JSON.stringify(afterDel)
    );
  } finally {
    await admin.from("tenants").delete().in("id", [t1.id, t2.id]);
    for (const id of authIds) await admin.auth.admin.deleteUser(id).catch(() => {});
  }

  console.log(`\n${pass} OK / ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
