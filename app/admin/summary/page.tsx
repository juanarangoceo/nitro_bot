import { getPlatformAdminContext } from "@/lib/admin/context";

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6">
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
    </div>
  );
}

const fmtCOP = (n: number) =>
  n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

export default async function PlatformSummaryPage() {
  const { admin } = await getPlatformAdminContext();
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [tenantsRes, ordersRes] = await Promise.all([
    admin
      .from("tenants")
      .select("id, name, is_active, plan, monthly_fee, message_limit, current_month_messages")
      .order("monthly_fee", { ascending: false, nullsFirst: false }),
    admin.from("orders").select("tenant_id, total, created_at").gte("created_at", startOfMonth),
  ]);

  const tenants = tenantsRes.data ?? [];
  const orders = ordersRes.data ?? [];

  const activeCount = tenants.filter((t) => t.is_active).length;
  const mrr = tenants
    .filter((t) => t.is_active)
    .reduce((s, t) => s + Number(t.monthly_fee ?? 0), 0);
  const totalMessages = tenants.reduce((s, t) => s + Number(t.current_month_messages ?? 0), 0);
  const totalRevenue = orders.reduce((s, o) => s + Number(o.total ?? 0), 0);

  // Ventas del mes por tenant (para la tabla de gasto/actividad por cliente).
  const revByTenant = new Map<string, number>();
  for (const o of orders) {
    revByTenant.set(o.tenant_id, (revByTenant.get(o.tenant_id) ?? 0) + Number(o.total ?? 0));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Resumen de plataforma</h1>
        <p className="text-sm text-neutral-500">Agregados de todos los clientes · mes en curso</p>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Clientes activos" value={`${activeCount} / ${tenants.length}`} />
        <Stat label="MRR (activos)" value={fmtCOP(mrr)} hint="Suma de mensualidades" />
        <Stat label="Ventas del mes" value={fmtCOP(totalRevenue)} hint={`${orders.length} órdenes`} />
        <Stat label="Mensajes del mes" value={totalMessages.toLocaleString("es-CO")} />
      </section>

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-neutral-900">Gasto y actividad por cliente</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
              <th className="px-6 py-2 font-medium">Cliente</th>
              <th className="px-6 py-2 font-medium">Plan</th>
              <th className="px-6 py-2 text-right font-medium">Mensualidad</th>
              <th className="px-6 py-2 text-right font-medium">Mensajes</th>
              <th className="px-6 py-2 text-right font-medium">Ventas del mes</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-t border-neutral-100">
                <td className="px-6 py-2.5 text-neutral-800">
                  {t.name}
                  {!t.is_active && <span className="ml-2 text-[11px] text-neutral-400">(pausado)</span>}
                </td>
                <td className="px-6 py-2.5 text-neutral-600">{t.plan ?? "—"}</td>
                <td className="px-6 py-2.5 text-right tabular-nums text-neutral-700">
                  {t.monthly_fee != null ? fmtCOP(Number(t.monthly_fee)) : "—"}
                </td>
                <td className="px-6 py-2.5 text-right tabular-nums text-neutral-700">
                  {Number(t.current_month_messages ?? 0).toLocaleString("es-CO")} /{" "}
                  {Number(t.message_limit ?? 0).toLocaleString("es-CO")}
                </td>
                <td className="px-6 py-2.5 text-right tabular-nums text-neutral-700">
                  {fmtCOP(revByTenant.get(t.id) ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
