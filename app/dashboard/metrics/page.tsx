import Link from "next/link";
import { getDashboardContext } from "@/lib/dashboard/context";
import { bogotaDayStart, bogotaDayEnd } from "@/lib/dates";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6">
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

type Period = "week" | "month";

// Inicio del período seleccionado: semana = últimos 7 días; mes = mes calendario.
function periodStart(period: Period): string {
  const now = new Date();
  if (period === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  }
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { supabase, tenant } = await getDashboardContext();
  const sp = await searchParams;
  const period: Period = sp.period === "week" ? "week" : "month";

  // Rango personalizado desde/hasta (días en hora de Colombia). Si viene un
  // rango válido, prevalece sobre el toggle Semana/Mes. `until` es exclusivo.
  const fromDay = sp.from && bogotaDayStart(sp.from) ? sp.from : "";
  const toDay = sp.to && bogotaDayEnd(sp.to) ? sp.to : "";
  const hasRange = Boolean(fromDay || toDay);
  const since = fromDay ? bogotaDayStart(fromDay)! : periodStart(period);
  const until = toDay ? bogotaDayEnd(toDay)! : null;

  // Las conversaciones de prueba no cuentan (is_test: probador de /admin y
  // números de prueba de la plataforma). Sus órdenes tampoco: se excluyen por
  // conversation_id (las órdenes con conversación borrada — null — sí cuentan).
  const { data: testConvs } = await supabase
    .from("conversations")
    .select("id")
    .eq("is_test", true);
  const testConvIds = (testConvs ?? []).map((c) => c.id);

  let ordersQuery = supabase
    .from("orders")
    .select("id, total, created_at, conversation_id")
    .gte("created_at", since);
  if (until) ordersQuery = ordersQuery.lt("created_at", until);
  if (testConvIds.length > 0) {
    ordersQuery = ordersQuery.or(
      `conversation_id.is.null,conversation_id.not.in.(${testConvIds.join(",")})`
    );
  }

  const [conversations, botActive, requiresHuman, ordersInPeriod, customers, items] =
    await Promise.all([
      supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("is_test", false),
      supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("status", "bot_active")
        .eq("is_test", false),
      supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("status", "requires_human")
        .eq("is_test", false),
      ordersQuery,
      supabase.from("customers").select("id", { count: "exact", head: true }),
      (() => {
        let q = supabase
          .from("order_items")
          .select("order_id, shopify_product_id, title, quantity, unit_price")
          .gte("created_at", since);
        if (until) q = q.lt("created_at", until);
        return q;
      })(),
    ]);

  const orders = ordersInPeriod.data ?? [];
  const orderIds = new Set(orders.map((o) => o.id));
  const revenue = orders.reduce((sum, o) => sum + Number(o.total ?? 0), 0);
  const fmtCOP = (n: number) =>
    n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

  // Agregación de productos más vendidos en el período.
  const byProduct = new Map<
    string,
    { title: string; units: number; revenue: number }
  >();
  for (const it of items.data ?? []) {
    // Ítems de órdenes de prueba fuera del top de productos (mismo criterio
    // que la venta total: solo órdenes del período ya filtradas).
    if (!orderIds.has(it.order_id)) continue;
    const key = it.shopify_product_id ?? it.title ?? "—";
    const prev = byProduct.get(key) ?? { title: it.title ?? "—", units: 0, revenue: 0 };
    prev.units += Number(it.quantity ?? 0);
    prev.revenue += Number(it.quantity ?? 0) * Number(it.unit_price ?? 0);
    byProduct.set(key, prev);
  }
  const topProducts = [...byProduct.values()]
    .sort((a, b) => b.units - a.units)
    .slice(0, 10);

  const fmtDay = (d: string) =>
    new Date(`${d}T12:00:00-05:00`).toLocaleDateString("es-CO", {
      day: "numeric",
      month: "short",
    });
  const periodLabel = hasRange
    ? `${fromDay ? `desde ${fmtDay(fromDay)}` : ""}${fromDay && toDay ? " " : ""}${
        toDay ? `hasta ${fmtDay(toDay)}` : ""
      }`
    : period === "week"
      ? "última semana"
      : "este mes";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Métricas</h1>
          <p className="text-sm text-neutral-500">Resumen de actividad del asesor</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-neutral-200 bg-white p-1 text-sm">
          {(["week", "month"] as Period[]).map((p) => (
            <Link
              key={p}
              href={`/dashboard/metrics?period=${p}`}
              className={`rounded-md px-3 py-1.5 ${
                period === p && !hasRange
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {p === "week" ? "Semana" : "Mes"}
            </Link>
          ))}
        </div>
      </header>

      {/* Rango personalizado (días en hora de Colombia). Aplica a órdenes,
          ventas y productos más vendidos; prevalece sobre Semana/Mes. */}
      <form
        method="get"
        action="/dashboard/metrics"
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        <label className="text-neutral-500">
          Desde{" "}
          <input
            type="date"
            name="from"
            defaultValue={fromDay}
            className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-neutral-500">
          Hasta{" "}
          <input
            type="date"
            name="to"
            defaultValue={toDay}
            className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
        >
          Filtrar
        </button>
        {hasRange && (
          <Link
            href="/dashboard/metrics"
            className="text-xs text-neutral-500 underline hover:text-neutral-900"
          >
            Limpiar
          </Link>
        )}
      </form>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat label="Conversaciones" value={conversations.count ?? 0} />
        <Stat label="Atendidas por el bot" value={botActive.count ?? 0} />
        <Stat label="Esperando humano" value={requiresHuman.count ?? 0} />
        <Stat label={`Órdenes (${periodLabel})`} value={orders.length} />
        <Stat label={`Ventas (${periodLabel})`} value={fmtCOP(revenue)} />
        <Stat label="Clientes (CRM)" value={customers.count ?? 0} />
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-neutral-900">
            Productos más vendidos · {periodLabel}
          </h2>
        </div>
        {topProducts.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-neutral-400">
            Aún no hay ventas en este período.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-6 py-2 font-medium">Producto</th>
                <th className="px-6 py-2 text-right font-medium">Unidades</th>
                <th className="px-6 py-2 text-right font-medium">Ventas</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map((p, i) => (
                <tr key={i} className="border-t border-neutral-100">
                  <td className="px-6 py-2.5 text-neutral-800">{p.title}</td>
                  <td className="px-6 py-2.5 text-right tabular-nums text-neutral-700">
                    {p.units}
                  </td>
                  <td className="px-6 py-2.5 text-right tabular-nums text-neutral-700">
                    {fmtCOP(p.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-xs text-neutral-400">
        Consumo del mes: {tenant.current_month_messages.toLocaleString("es-CO")} /{" "}
        {tenant.message_limit.toLocaleString("es-CO")} mensajes.
      </p>
    </div>
  );
}
