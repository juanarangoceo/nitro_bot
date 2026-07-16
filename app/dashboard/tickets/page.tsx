import { getDashboardContext } from "@/lib/dashboard/context";
import { TicketsClient, type TicketRow } from "./tickets-client";

export default async function TicketsPage() {
  const { supabase, user, role } = await getDashboardContext();

  // Etiquetas del agente: filtran su bandeja. Solo el admin ve todo; un agente
  // ve los tickets de sus etiquetas + los «Sin etiqueta» (visibles para todo
  // el equipo). Sin etiquetas asignadas ve únicamente los sin etiqueta. La
  // misma regla la impone RLS (0024) — este filtro es defensa en profundidad.
  let labelIds: string[] = [];
  if (role === "agent") {
    const { data } = await supabase
      .from("app_user_labels")
      .select("label_id")
      .eq("user_id", user.id);
    labelIds = (data ?? []).map((r) => r.label_id as string);
  }

  let query = supabase
    .from("tickets")
    .select(
      "id, reason, created_at, conversation_id, label_id, ticket_labels(name), conversations(customer_phone, status)"
    )
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (role === "agent") {
    query =
      labelIds.length > 0
        ? query.or(`label_id.is.null,label_id.in.(${labelIds.join(",")})`)
        : query.is("label_id", null);
  }

  // Equipo del tenant (RLS: app_users_team_select) para mostrar quién
  // respondió cada mensaje de agente: id → nombre (o correo).
  const [{ data }, { data: teamRows }] = await Promise.all([
    query,
    supabase.from("app_users").select("id, name, email"),
  ]);
  const team: Record<string, string> = {};
  for (const u of teamRows ?? []) {
    const label = u.name ?? u.email;
    if (label) team[u.id] = label;
  }

  // Supabase devuelve la relación embebida; la normalizamos a objeto plano.
  const tickets: TicketRow[] = (data ?? []).map((t) => {
    const conv = Array.isArray(t.conversations) ? t.conversations[0] : t.conversations;
    const label = Array.isArray(t.ticket_labels) ? t.ticket_labels[0] : t.ticket_labels;
    return {
      id: t.id,
      reason: t.reason,
      created_at: t.created_at,
      conversation_id: t.conversation_id,
      customer_phone: conv?.customer_phone ?? "—",
      status: conv?.status ?? "—",
      label_name: label?.name ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Tickets</h1>
        <p className="text-sm text-neutral-500">
          Conversaciones escaladas a un humano (en vivo)
        </p>
      </header>

      <TicketsClient initialTickets={tickets} team={team} />
    </div>
  );
}
