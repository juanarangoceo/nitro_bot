import { getDashboardContext } from "@/lib/dashboard/context";

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", { month: "long", year: "numeric" });
}

export default async function DashboardHome() {
  const { tenant, supabase } = await getDashboardContext();

  const used = tenant.current_month_messages;
  const limit = tenant.message_limit || 1;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const alert80 = pct >= 80;

  // Conteos rápidos (RLS los limita al tenant).
  const [{ count: openTickets }, { count: customers }] = await Promise.all([
    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    supabase.from("customers").select("id", { count: "exact", head: true }),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Inicio</h1>
        <p className="text-sm text-neutral-500">
          Consumo de {monthLabel(tenant.counter_period_start)}
        </p>
      </header>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-sm text-neutral-500">Mensajes este mes</p>
            <p className="mt-1 text-3xl font-semibold text-neutral-900">
              {used.toLocaleString("es-CO")}{" "}
              <span className="text-base font-normal text-neutral-400">
                / {limit.toLocaleString("es-CO")}
              </span>
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              alert80 ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-600"
            }`}
          >
            {pct}%
          </span>
        </div>

        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
          <div
            className={`h-full rounded-full ${alert80 ? "bg-amber-500" : "bg-neutral-900"}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {alert80 && (
          <p className="mt-3 text-sm text-amber-700">
            ⚠️ Vas en el {pct}% de tu plan mensual. Considera ampliar el límite para no
            interrumpir la atención.
          </p>
        )}
      </section>

      <section className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-6">
          <p className="text-sm text-neutral-500">Tickets abiertos</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{openTickets ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-6">
          <p className="text-sm text-neutral-500">Clientes (CRM)</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{customers ?? 0}</p>
        </div>
      </section>
    </div>
  );
}
