// Salud de la plataforma: errores y advertencias recientes de event_log.
// Solo super-admin (gate explícito); lee con service_role — el cliente nunca
// ve esta tabla. Filtros por tenant y tipo, paginación simple.

import Link from "next/link";
import { getPlatformAdminContext } from "@/lib/admin/context";

const PAGE_SIZE = 50;

const KINDS = [
  "assistant_error",
  "tool_trace",
  "queue_failure",
  "escalation_auto",
  "notify_failure",
  "backup",
] as const;

function summarizeDetail(detail: unknown): string {
  if (detail == null) return "—";
  if (typeof detail === "string") return detail.slice(0, 180);
  try {
    const obj = detail as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message.slice(0, 180);
    return JSON.stringify(detail).slice(0, 180);
  } catch {
    return "—";
  }
}

export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; kind?: string; page?: string }>;
}) {
  const { admin } = await getPlatformAdminContext();
  const sp = await searchParams;
  const tenantFilter = sp.tenant ?? "";
  const kindFilter = sp.kind ?? "";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let query = admin
    .from("event_log")
    .select("id, tenant_id, conversation_id, kind, severity, detail, created_at")
    .in("severity", ["warning", "error"])
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (tenantFilter) query = query.eq("tenant_id", tenantFilter);
  if (kindFilter) query = query.eq("kind", kindFilter);

  const [{ data: events }, errors24h, { data: tenants }] = await Promise.all([
    query,
    admin
      .from("event_log")
      .select("id", { count: "exact", head: true })
      .eq("severity", "error")
      .gte("created_at", since24h),
    admin.from("tenants").select("id, name").order("name"),
  ]);

  const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.name]));
  const rows = events ?? [];
  const errCount = errors24h.count ?? 0;

  const filterHref = (p: { tenant?: string; kind?: string; page?: number }) => {
    const params = new URLSearchParams();
    const t = p.tenant ?? tenantFilter;
    const k = p.kind ?? kindFilter;
    if (t) params.set("tenant", t);
    if (k) params.set("kind", k);
    if (p.page && p.page > 1) params.set("page", String(p.page));
    const qs = params.toString();
    return `/admin/health${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Salud</h1>
        <p className="text-sm text-neutral-500">
          Errores y advertencias de la plataforma (event_log)
        </p>
      </header>

      <div
        className={`rounded-2xl border p-6 ${
          errCount === 0
            ? "border-emerald-200 bg-emerald-50"
            : "border-red-200 bg-red-50"
        }`}
      >
        <p className={`text-sm ${errCount === 0 ? "text-emerald-700" : "text-red-700"}`}>
          {errCount === 0
            ? "✅ Sin errores en las últimas 24 horas."
            : `🔴 ${errCount} error(es) en las últimas 24 horas.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form method="get" action="/admin/health" className="flex flex-wrap items-center gap-2">
          <select
            name="tenant"
            defaultValue={tenantFilter}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todos los clientes</option>
            {(tenants ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            name="kind"
            defaultValue={kindFilter}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todos los tipos</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Filtrar
          </button>
        </form>
        {(tenantFilter || kindFilter) && (
          <Link href="/admin/health" className="text-xs text-neutral-500 hover:underline">
            Limpiar filtros
          </Link>
        )}
      </div>

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-neutral-400">
            Sin eventos para los filtros actuales.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-4 py-2 font-medium">Cliente</th>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">Detalle</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-t border-neutral-100 align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-500">
                    {new Date(e.created_at).toLocaleString("es-CO")}
                  </td>
                  <td className="px-4 py-2.5 text-neutral-700">
                    {e.tenant_id ? (
                      <Link href={`/admin/clients/${e.tenant_id}`} className="hover:underline">
                        {tenantName.get(e.tenant_id) ?? e.tenant_id.slice(0, 8)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        e.severity === "error"
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {e.kind}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-neutral-600">
                    {summarizeDetail(e.detail)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {e.conversation_id && (
                      <Link
                        href={`/admin/conversations/${e.conversation_id}`}
                        className="text-xs text-neutral-500 hover:underline"
                      >
                        Ver conversación →
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="flex items-center justify-between text-sm">
        {page > 1 ? (
          <Link href={filterHref({ page: page - 1 })} className="text-neutral-600 hover:underline">
            ← Más recientes
          </Link>
        ) : (
          <span />
        )}
        {rows.length === PAGE_SIZE && (
          <Link href={filterHref({ page: page + 1 })} className="text-neutral-600 hover:underline">
            Más antiguos →
          </Link>
        )}
      </div>
    </div>
  );
}
