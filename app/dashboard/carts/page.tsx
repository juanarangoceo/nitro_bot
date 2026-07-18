// «Carritos» — recuperación de carritos abandonados por WhatsApp (Spec 13).
// Lee abandoned_checkouts (RLS por tenant; lo escriben los webhooks y el cron)
// y muestra los 3 contadores del período + la tabla de checkouts. Solo lectura.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/context";
import { bogotaDayStart, bogotaDayEnd } from "@/lib/dates";
import { formatCop } from "@/lib/billing";
import { CART_STATUS_LABELS } from "@/lib/carts/settings";

const MAX_ROWS = 2000;

type CartRow = {
  id: string;
  phone: string;
  customer_name: string | null;
  line_items: { title?: string; quantity?: number }[];
  total_price: number | null;
  status: string;
  reminder_1_sent_at: string | null;
  reminder_2_sent_at: string | null;
  recovered_shopify_order_id: string | null;
  created_at: string;
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function CartsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { supabase, tenant } = await getDashboardContext();
  if (!tenant.abandoned_carts_enabled || tenant.modules?.carts === false) {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  const fromDay = sp.from && bogotaDayStart(sp.from) ? sp.from : "";
  const toDay = sp.to && bogotaDayEnd(sp.to) ? sp.to : "";
  const hasRange = Boolean(fromDay || toDay);

  // Default: últimos 30 días.
  const defaultSince = new Date();
  defaultSince.setDate(defaultSince.getDate() - 30);
  const since = fromDay ? bogotaDayStart(fromDay)! : defaultSince.toISOString();
  const until = toDay ? bogotaDayEnd(toDay)! : null;

  let query = supabase
    .from("abandoned_checkouts")
    .select(
      "id, phone, customer_name, line_items, total_price, status, reminder_1_sent_at, reminder_2_sent_at, recovered_shopify_order_id, created_at"
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (until) query = query.lt("created_at", until);
  const { data } = await query;
  const rows: CartRow[] = (data ?? []) as CartRow[];

  const detected = rows.length;
  const remindersSent = rows.reduce(
    (acc, r) => acc + (r.reminder_1_sent_at ? 1 : 0) + (r.reminder_2_sent_at ? 1 : 0),
    0
  );
  const recovered = rows.filter((r) => r.status === "recovered");
  const recoveredCop = recovered.reduce((acc, r) => acc + Number(r.total_price ?? 0), 0);

  const rangeLabel = hasRange
    ? `${fromDay ? `desde ${fromDay}` : ""}${fromDay && toDay ? " " : ""}${toDay ? `hasta ${toDay}` : ""}`
    : "últimos 30 días";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Carritos abandonados</h1>
        <p className="text-sm text-neutral-500">
          Compradores que dejaron su compra a medias y recibieron un recordatorio por
          WhatsApp ({rangeLabel})
        </p>
      </header>

      <form
        method="get"
        action="/dashboard/carts"
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
            href="/dashboard/carts"
            className="text-xs text-neutral-500 underline hover:text-neutral-900"
          >
            Limpiar
          </Link>
        )}
      </form>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-neutral-400">
            Carritos detectados
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">
            {detected}
          </p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-neutral-400">
            Recordatorios enviados
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">
            {remindersSent}
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-xs uppercase tracking-wide text-emerald-600">
            Ventas recuperadas
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">
            {formatCop(recoveredCop)}
          </p>
          <p className="text-xs text-emerald-600">
            {recovered.length} {recovered.length === 1 ? "carrito" : "carritos"}
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-neutral-900">Detalle</h2>
          <p className="text-xs text-neutral-400">
            «Compró antes» = completó la compra sin necesitar recordatorio
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-neutral-400">
            Aún no hay carritos abandonados en este período.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                  <th className="px-6 py-2 font-medium">Fecha</th>
                  <th className="px-6 py-2 font-medium">Comprador</th>
                  <th className="px-6 py-2 font-medium">Productos</th>
                  <th className="px-6 py-2 text-right font-medium">Total</th>
                  <th className="px-6 py-2 text-center font-medium">Recordatorios</th>
                  <th className="px-6 py-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const badge = CART_STATUS_LABELS[r.status] ?? {
                    label: r.status,
                    className: "bg-neutral-100 text-neutral-500",
                  };
                  const sent = (r.reminder_1_sent_at ? 1 : 0) + (r.reminder_2_sent_at ? 1 : 0);
                  const items = (r.line_items ?? [])
                    .map((li) => li.title)
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <tr key={r.id} className="border-t border-neutral-100">
                      <td className="whitespace-nowrap px-6 py-2.5 text-neutral-500">
                        {fmtDate(r.created_at)}
                      </td>
                      <td className="px-6 py-2.5 text-neutral-800">
                        {r.customer_name ?? "—"}
                        <span className="block text-xs text-neutral-400">{r.phone}</span>
                      </td>
                      <td className="max-w-56 truncate px-6 py-2.5 text-neutral-600">
                        {items || "—"}
                      </td>
                      <td className="whitespace-nowrap px-6 py-2.5 text-right tabular-nums text-neutral-700">
                        {r.total_price != null ? formatCop(Number(r.total_price)) : "—"}
                      </td>
                      <td className="px-6 py-2.5 text-center tabular-nums text-neutral-500">
                        {sent}/2
                      </td>
                      <td className="px-6 py-2.5">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
