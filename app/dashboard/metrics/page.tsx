import { getDashboardContext } from "@/lib/dashboard/context";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6">
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

export default async function MetricsPage() {
  const { supabase, tenant } = await getDashboardContext();

  const startOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  ).toISOString();

  const [
    conversations,
    botActive,
    requiresHuman,
    ordersThisMonth,
    customers,
  ] = await Promise.all([
    supabase.from("conversations").select("id", { count: "exact", head: true }),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("status", "bot_active"),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("status", "requires_human"),
    supabase
      .from("orders")
      .select("total, created_at")
      .gte("created_at", startOfMonth),
    supabase.from("customers").select("id", { count: "exact", head: true }),
  ]);

  const orders = ordersThisMonth.data ?? [];
  const revenue = orders.reduce((sum, o) => sum + Number(o.total ?? 0), 0);
  const fmtCOP = (n: number) =>
    n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Métricas</h1>
        <p className="text-sm text-neutral-500">Resumen de actividad del asesor</p>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat label="Conversaciones" value={conversations.count ?? 0} />
        <Stat label="Atendidas por el bot" value={botActive.count ?? 0} />
        <Stat label="Esperando humano" value={requiresHuman.count ?? 0} />
        <Stat label="Órdenes este mes" value={orders.length} />
        <Stat label="Ventas este mes" value={fmtCOP(revenue)} />
        <Stat label="Clientes (CRM)" value={customers.count ?? 0} />
      </section>

      <p className="text-xs text-neutral-400">
        Consumo del mes: {tenant.current_month_messages.toLocaleString("es-CO")} /{" "}
        {tenant.message_limit.toLocaleString("es-CO")} mensajes.
      </p>
    </div>
  );
}
