import { getDashboardContext } from "@/lib/dashboard/context";
import { TicketsClient, type TicketRow } from "./tickets-client";

export default async function TicketsPage() {
  const { supabase, user, role } = await getDashboardContext();

  // Etiquetas del agente: filtra su bandeja. Un agente SIN etiquetas asignadas
  // ve todo (opt-in al filtro); el admin siempre ve todo. Los tickets sin
  // etiqueta son visibles para todos (nadie queda sin atender).
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
  if (role === "agent" && labelIds.length > 0) {
    query = query.or(`label_id.is.null,label_id.in.(${labelIds.join(",")})`);
  }
  const { data } = await query;

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

      <TicketsClient initialTickets={tickets} />
    </div>
  );
}
