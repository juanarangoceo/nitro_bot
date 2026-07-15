// «Etiquetas» — módulo del dashboard visible SOLO para el admin del tenant:
// administra las etiquetas de los tickets (el bot clasifica cada escalado con
// una) y qué etiquetas atiende cada usuario del equipo. Un agente ve en
// Tickets solo los de sus etiquetas + los tickets sin etiqueta; sin etiquetas
// asignadas ve todo.

import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/context";
import {
  NewLabelForm,
  LabelItem,
  UserLabelsForm,
  type LabelRow,
  type TeamUser,
} from "./labels-client";

export default async function LabelsPage() {
  const { supabase, role, tenant } = await getDashboardContext();
  if (role !== "admin") redirect("/dashboard");
  if (tenant.modules?.labels === false) redirect("/dashboard");

  const [{ data: labels }, { data: users }, { data: assignments }, { data: openTickets }] =
    await Promise.all([
      supabase
        .from("ticket_labels")
        .select("id, name, is_active")
        .order("created_at", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("app_users")
        .select("id, email, role")
        .order("created_at", { ascending: true }),
      supabase.from("app_user_labels").select("user_id, label_id"),
      supabase.from("tickets").select("label_id").eq("status", "open"),
    ]);

  const openByLabel = new Map<string, number>();
  for (const t of openTickets ?? []) {
    if (t.label_id) openByLabel.set(t.label_id, (openByLabel.get(t.label_id) ?? 0) + 1);
  }

  const labelRows: LabelRow[] = (labels ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    is_active: l.is_active,
    open_tickets: openByLabel.get(l.id) ?? 0,
  }));
  const activeLabels = labelRows.filter((l) => l.is_active);

  const labelsByUser = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    const list = labelsByUser.get(a.user_id) ?? [];
    list.push(a.label_id);
    labelsByUser.set(a.user_id, list);
  }

  const team: TeamUser[] = (users ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    label_ids: labelsByUser.get(u.id) ?? [],
  }));
  const agents = team.filter((u) => u.role === "agent");
  const admins = team.filter((u) => u.role === "admin");

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Etiquetas</h1>
        <p className="text-sm text-neutral-500">
          El asesor clasifica cada ticket con una etiqueta. Asigna etiquetas a tu
          equipo para que cada persona vea solo los tickets de su área.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-900">Etiquetas del equipo</h2>
        <NewLabelForm />
        {labelRows.length === 0 && (
          <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400">
            No hay etiquetas. Crea la primera arriba.
          </p>
        )}
        {labelRows.map((l) => (
          <LabelItem key={l.id} label={l} />
        ))}
        <p className="text-xs text-neutral-500">
          Los tickets sin etiqueta los ve todo el equipo. Al eliminar una etiqueta,
          sus tickets quedan sin etiqueta (no se pierden); «Desactivar» la pausa sin
          tocar los tickets ya clasificados.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-900">Asignación por agente</h2>
        {agents.length === 0 && (
          <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400">
            No hay agentes en tu equipo (los administradores ven todos los tickets).
          </p>
        )}
        {agents.map((u) => (
          <UserLabelsForm key={u.id} user={u} labels={activeLabels} />
        ))}
        {admins.length > 0 && (
          <p className="text-xs text-neutral-500">
            Administradores ({admins.map((a) => a.email ?? a.id).join(", ")}): ven
            todos los tickets, no necesitan etiquetas.
          </p>
        )}
      </section>
    </div>
  );
}
