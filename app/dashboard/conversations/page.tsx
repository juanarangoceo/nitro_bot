import { getDashboardContext } from "@/lib/dashboard/context";
import { ConversationsClient, type ConversationRow } from "./conversations-client";

// En la sintaxis de .or() de PostgREST, comas/paréntesis separan condiciones y
// % es el comodín de ilike: se quitan del término del usuario.
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()%]/g, "").trim().slice(0, 60);
}

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { supabase, role } = await getDashboardContext();
  const q = sanitizeSearch((await searchParams).q ?? "");

  // Conversaciones del tenant (RLS), las de actividad más reciente primero.
  // Las is_test SÍ se muestran, con badge «Prueba» (números de prueba de la
  // plataforma: no descuentan mensajes). La única oculta es la sintética del
  // probador interno de /admin (teléfono +570000000000).
  let query = supabase
    .from("conversations")
    .select("id, customer_phone, status, is_test, last_customer_message_at, created_at")
    .neq("customer_phone", "+570000000000")
    .order("last_customer_message_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (q) {
    // Buscar por teléfono directo y por nombre en el CRM (RLS acota al tenant).
    const phoneTerm = q.replace(/[\s.-]/g, "");
    const { data: matched } = await supabase
      .from("customers")
      .select("phone")
      .or(`name.ilike.%${q}%${phoneTerm ? `,phone.ilike.%${phoneTerm}%` : ""}`)
      .limit(200);
    const phones = (matched ?? []).map((c) => c.phone).filter(Boolean);

    const conditions: string[] = [];
    if (phoneTerm) conditions.push(`customer_phone.ilike.%${phoneTerm}%`);
    if (phones.length > 0) conditions.push(`customer_phone.in.(${phones.join(",")})`);
    // Término sin nada buscable (p. ej. solo puntuación y sin match de nombre):
    // condición imposible para devolver lista vacía en vez de todo.
    query = query.or(conditions.length > 0 ? conditions.join(",") : "id.is.null");
  }

  const { data } = await query;
  const rows = data ?? [];

  // Nombre del contacto (CRM) para mostrarlo junto al teléfono.
  const listPhones = [...new Set(rows.map((c) => c.customer_phone))];
  const nameByPhone = new Map<string, string>();
  if (listPhones.length > 0) {
    const { data: contacts } = await supabase
      .from("customers")
      .select("phone, name")
      .in("phone", listPhones);
    for (const c of contacts ?? []) {
      if (c.name) nameByPhone.set(c.phone, c.name);
    }
  }

  const conversations: ConversationRow[] = rows.map((c) => ({
    ...c,
    customer_name: nameByPhone.get(c.customer_phone) ?? null,
  }));

  // Equipo del tenant (RLS: app_users_team_select) para mostrar quién
  // respondió cada mensaje de agente: id → nombre (o correo).
  const { data: teamRows } = await supabase.from("app_users").select("id, name, email");
  const team: Record<string, string> = {};
  for (const u of teamRows ?? []) {
    const label = u.name ?? u.email;
    if (label) team[u.id] = label;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Conversaciones</h1>
        <p className="text-sm text-neutral-500">
          Monitoreo en vivo (solo lectura). Para responder, usa Tickets.
        </p>
      </header>

      <form method="get" action="/dashboard/conversations" className="flex items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre o teléfono…"
          className="w-full max-w-xs rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        />
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Buscar
        </button>
        {q && (
          <a
            href="/dashboard/conversations"
            className="text-sm text-neutral-500 underline hover:text-neutral-900"
          >
            Limpiar
          </a>
        )}
        {q && (
          <span className="text-sm text-neutral-500">
            {conversations.length === 0
              ? "Sin resultados"
              : `${conversations.length} resultado${conversations.length === 1 ? "" : "s"}`}
          </span>
        )}
      </form>

      <ConversationsClient
        initialConversations={conversations}
        team={team}
        isAdmin={role === "admin"}
      />
    </div>
  );
}
