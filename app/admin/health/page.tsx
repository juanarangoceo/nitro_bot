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
  "support_request",
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
  const since14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  let query = admin
    .from("event_log")
    .select("id, tenant_id, conversation_id, kind, severity, detail, created_at")
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (tenantFilter) query = query.eq("tenant_id", tenantFilter);
  // Sin filtro de tipo, la vista muestra solo problemas (warning/error). Al
  // filtrar por un tipo concreto se ven también sus eventos informativos
  // (p. ej. support_request o reminder).
  if (kindFilter) query = query.eq("kind", kindFilter);
  else query = query.in("severity", ["warning", "error"]);

  const [{ data: events }, errors24h, { data: tenants }, { data: usageRows }] = await Promise.all([
    query,
    admin
      .from("event_log")
      .select("id", { count: "exact", head: true })
      .eq("severity", "error")
      .gte("created_at", since24h),
    admin.from("tenants").select("id, name").order("name"),
    admin
      .from("event_log")
      .select("conversation_id, detail, created_at")
      .eq("kind", "gemini_usage")
      .gte("created_at", since14d)
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);

  const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.name]));
  const rows = events ?? [];
  const errCount = errors24h.count ?? 0;

  // —— Tokens Gemini (14 días): agregación por día + top conversaciones ——
  type UsageDetail = {
    calls?: number;
    promptTokens?: number;
    outputTokens?: number;
    thoughtsTokens?: number;
    cachedTokens?: number;
    audioTokens?: number;
    source?: string;
  };
  type DayAgg = {
    turns: number;
    calls: number;
    prompt: number;
    output: number;
    thoughts: number;
    audio: number;
    cached: number;
    bySource: Record<string, number>;
  };
  const byDay = new Map<string, DayAgg>();
  const byConv = new Map<string, number>();
  for (const r of usageRows ?? []) {
    const d = (r.detail ?? {}) as UsageDetail;
    const day = String(r.created_at).slice(0, 10);
    const agg =
      byDay.get(day) ??
      ({ turns: 0, calls: 0, prompt: 0, output: 0, thoughts: 0, audio: 0, cached: 0, bySource: {} } as DayAgg);
    agg.turns += 1;
    agg.calls += d.calls ?? 0;
    agg.prompt += d.promptTokens ?? 0;
    agg.output += d.outputTokens ?? 0;
    agg.thoughts += d.thoughtsTokens ?? 0;
    agg.audio += d.audioTokens ?? 0;
    agg.cached += d.cachedTokens ?? 0;
    const src = d.source ?? "?";
    agg.bySource[src] = (agg.bySource[src] ?? 0) + 1;
    byDay.set(day, agg);
    if (r.conversation_id) {
      byConv.set(
        r.conversation_id,
        (byConv.get(r.conversation_id) ?? 0) +
          (d.promptTokens ?? 0) +
          (d.outputTokens ?? 0) +
          (d.thoughtsTokens ?? 0)
      );
    }
  }
  const usageDays = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const topConvs = [...byConv.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const fmt = (n: number) => n.toLocaleString("es-CO");

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

      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-neutral-900">Tokens Gemini (14 días)</h2>
        <p className="mt-0.5 text-xs text-neutral-400">
          Entrada = lo facturado sumando todas las rondas del turno · Thinking se factura como
          salida · Audio es la parte del input a tarifa de audio · Caché tiene descuento.
        </p>
        {usageDays.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">
            Aún no hay mediciones (se registran a partir de este despliegue).
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                  <th className="px-2 py-1.5 font-medium">Día</th>
                  <th className="px-2 py-1.5 text-right font-medium">Turnos</th>
                  <th className="px-2 py-1.5 text-right font-medium">Llamadas</th>
                  <th className="px-2 py-1.5 text-right font-medium">Entrada</th>
                  <th className="px-2 py-1.5 text-right font-medium">Salida</th>
                  <th className="px-2 py-1.5 text-right font-medium">Thinking</th>
                  <th className="px-2 py-1.5 text-right font-medium">Audio</th>
                  <th className="px-2 py-1.5 text-right font-medium">Caché</th>
                  <th className="px-2 py-1.5 font-medium">Origen</th>
                </tr>
              </thead>
              <tbody>
                {usageDays.map(([day, a]) => (
                  <tr key={day} className="border-t border-neutral-100">
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs text-neutral-600">{day}</td>
                    <td className="px-2 py-1.5 text-right text-neutral-700">{fmt(a.turns)}</td>
                    <td className="px-2 py-1.5 text-right text-neutral-700">{fmt(a.calls)}</td>
                    <td className="px-2 py-1.5 text-right font-medium text-neutral-900">{fmt(a.prompt)}</td>
                    <td className="px-2 py-1.5 text-right text-neutral-700">{fmt(a.output)}</td>
                    <td className="px-2 py-1.5 text-right text-neutral-500">{fmt(a.thoughts)}</td>
                    <td className="px-2 py-1.5 text-right text-neutral-700">{fmt(a.audio)}</td>
                    <td className="px-2 py-1.5 text-right text-neutral-500">{fmt(a.cached)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs text-neutral-500">
                      {Object.entries(a.bySource)
                        .map(([s, n]) => `${s}: ${n}`)
                        .join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {topConvs.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-neutral-600">
              Conversaciones que más tokens quemaron (14 días)
            </p>
            <ul className="mt-1 space-y-1">
              {topConvs.map(([convId, tokens]) => (
                <li key={convId} className="flex items-center justify-between text-xs">
                  <Link
                    href={`/admin/conversations/${convId}`}
                    className="text-neutral-600 hover:underline"
                  >
                    {convId.slice(0, 8)}… →
                  </Link>
                  <span className="text-neutral-500">{fmt(tokens)} tokens</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

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
                          : e.severity === "warning"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-neutral-100 text-neutral-600"
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
