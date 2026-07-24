import Link from "next/link";
import { getPlatformAdminContext } from "@/lib/admin/context";

type MetricRow = {
  tenant_id: string;
  tenant_name: string;
  msg_type: "text" | "image" | "audio" | "video";
  message_count: number;
};

const TYPES = [
  { key: "text", label: "Texto", icon: "💬" },
  { key: "image", label: "Imágenes", icon: "🖼️" },
  { key: "audio", label: "Voz", icon: "🎙️" },
  { key: "video", label: "Videos", icon: "🎬" },
] as const;

function CountCard({
  label,
  icon,
  value,
}: {
  label: string;
  icon: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6">
      <p className="text-sm text-neutral-500">
        <span className="mr-1.5" aria-hidden="true">{icon}</span>
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-neutral-900">
        {value.toLocaleString("es-CO")}
      </p>
    </div>
  );
}

export default async function AdminMessageMetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { admin } = await getPlatformAdminContext();
  const sp = await searchParams;
  const tenantFilter = sp.tenant ?? "";

  const [{ data: tenants }, metricResult] = await Promise.all([
    admin.from("tenants").select("id, name, is_active").order("name"),
    admin.rpc("admin_bot_message_counts", {
      p_tenant_id: tenantFilter || null,
    }),
  ]);
  const rows = (metricResult.data as MetricRow[] | null) ?? [];

  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.msg_type, (totals.get(row.msg_type) ?? 0) + Number(row.message_count));
  }

  const byTenant = new Map<string, { id: string; name: string; counts: Map<string, number> }>();
  for (const row of rows) {
    const current = byTenant.get(row.tenant_id) ?? {
      id: row.tenant_id,
      name: row.tenant_name,
      counts: new Map<string, number>(),
    };
    current.counts.set(row.msg_type, Number(row.message_count));
    byTenant.set(row.tenant_id, current);
  }

  const selectedName = tenantFilter
    ? (tenants ?? []).find((tenant) => tenant.id === tenantFilter)?.name ?? "Cliente"
    : "Todos los clientes";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Métricas de mensajes</h1>
        <p className="text-sm text-neutral-500">
          Contenido enviado por el bot · {selectedName} · excluye pruebas y respuestas humanas
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <form method="get" action="/admin/message-metrics" className="flex items-center gap-2">
          <select
            name="tenant"
            defaultValue={tenantFilter}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todos los clientes</option>
            {(tenants ?? []).map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}{tenant.is_active ? "" : " (pausado)"}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Ver métricas
          </button>
        </form>
        {tenantFilter && (
          <Link
            href="/admin/message-metrics"
            className="text-xs text-neutral-500 hover:underline"
          >
            Ver todos
          </Link>
        )}
      </div>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {TYPES.map((type) => (
          <CountCard
            key={type.key}
            label={type.label}
            icon={type.icon}
            value={totals.get(type.key) ?? 0}
          />
        ))}
      </section>

      {!tenantFilter && (
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          <div className="border-b border-neutral-100 px-6 py-4">
            <h2 className="text-sm font-semibold text-neutral-900">Detalle por cliente</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                  <th className="px-6 py-2 font-medium">Cliente</th>
                  {TYPES.map((type) => (
                    <th key={type.key} className="px-6 py-2 text-right font-medium">
                      {type.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...byTenant.values()].map((tenant) => (
                  <tr key={tenant.id} className="border-t border-neutral-100">
                    <td className="px-6 py-2.5 font-medium text-neutral-800">{tenant.name}</td>
                    {TYPES.map((type) => (
                      <td
                        key={type.key}
                        className="px-6 py-2.5 text-right tabular-nums text-neutral-700"
                      >
                        {(tenant.counts.get(type.key) ?? 0).toLocaleString("es-CO")}
                      </td>
                    ))}
                  </tr>
                ))}
                {byTenant.size === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-10 text-center text-sm text-neutral-400"
                    >
                      Aún no hay mensajes enviados por el bot.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-xs text-neutral-400">
        Los conteos son históricos y se calculan en PostgreSQL. “Voz” corresponde a notas de
        audio enviadas por el bot; no cuenta audios enviados por agentes.
      </p>
    </div>
  );
}
