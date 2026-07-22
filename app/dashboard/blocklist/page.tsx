// «Bloqueados» — módulo del dashboard visible SOLO para el admin del tenant:
// números a los que el asesor no debe responder (spam, clientes bloqueados).
// Un número bloqueado se ignora por completo: el bot calla, no se persiste
// nada, no descuenta del plan y tampoco recibe recordatorios ni plantillas
// de carrito (gates en worker/reminders/carts; RLS en migración 0036).

import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/context";
import { BlockedList, NewBlockForm, type BlockedRow } from "./blocklist-client";

export default async function BlocklistPage() {
  const { supabase, role, tenant } = await getDashboardContext();
  if (role !== "admin") redirect("/dashboard");
  if (tenant.modules?.blocklist === false) redirect("/dashboard");

  const [{ data: rows }, { data: teamRows }] = await Promise.all([
    supabase
      .from("blocked_numbers")
      .select("id, phone, note, created_by, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("app_users").select("id, name, email"),
  ]);
  const team: Record<string, string> = {};
  for (const u of teamRows ?? []) {
    const label = u.name ?? u.email;
    if (label) team[u.id] = label;
  }

  const blocked: BlockedRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    phone: r.phone,
    note: r.note,
    created_at: r.created_at,
    created_by_name: (r.created_by && team[r.created_by]) || null,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Bloqueados</h1>
        <p className="text-sm text-neutral-500">
          Números a los que el asesor no responde (spam o clientes bloqueados)
        </p>
      </header>

      <NewBlockForm />
      <BlockedList rows={blocked} />
    </div>
  );
}
