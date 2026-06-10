import { getDashboardContext } from "@/lib/dashboard/context";
import { ConversationsClient, type ConversationRow } from "./conversations-client";

export default async function ConversationsPage() {
  const { supabase } = await getDashboardContext();

  // Conversaciones del tenant (RLS), las de actividad más reciente primero.
  // Las de prueba del probador (/admin) no se muestran al cliente (is_test).
  const { data } = await supabase
    .from("conversations")
    .select("id, customer_phone, status, last_customer_message_at, created_at")
    .eq("is_test", false)
    .order("last_customer_message_at", { ascending: false, nullsFirst: false })
    .limit(100);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Conversaciones</h1>
        <p className="text-sm text-neutral-500">
          Monitoreo en vivo (solo lectura). Para responder, usa Tickets.
        </p>
      </header>

      <ConversationsClient initialConversations={(data as ConversationRow[]) ?? []} />
    </div>
  );
}
