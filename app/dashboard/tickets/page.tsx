import { getDashboardContext } from "@/lib/dashboard/context";
import { TicketsClient, type TicketRow } from "./tickets-client";

export default async function TicketsPage() {
  const { supabase } = await getDashboardContext();

  const { data } = await supabase
    .from("tickets")
    .select(
      "id, reason, created_at, conversation_id, conversations(customer_phone, status)"
    )
    .eq("status", "open")
    .order("created_at", { ascending: false });

  // Supabase devuelve la relación embebida; la normalizamos a objeto plano.
  const tickets: TicketRow[] = (data ?? []).map((t) => {
    const conv = Array.isArray(t.conversations) ? t.conversations[0] : t.conversations;
    return {
      id: t.id,
      reason: t.reason,
      created_at: t.created_at,
      conversation_id: t.conversation_id,
      customer_phone: conv?.customer_phone ?? "—",
      status: conv?.status ?? "—",
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
