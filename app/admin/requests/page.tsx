// Bandeja unificada de Solicitudes de TODOS los tenants (solo super-admin).
// Orden: 'nueva' primero, luego más recientes. Filtros por estado, categoría
// y cliente vía query params (mismo patrón de /admin/health).

import Link from "next/link";
import { getPlatformAdminContext } from "@/lib/admin/context";
import {
  CATEGORY_LABELS,
  REQUEST_CATEGORIES,
  REQUEST_STATUSES,
  STATUS_BADGE,
  STATUS_LABELS,
  formatEta,
  type RequestCategory,
  type RequestStatus,
} from "@/lib/support/labels";

export default async function AdminRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string; tenant?: string }>;
}) {
  const { admin } = await getPlatformAdminContext();
  const sp = await searchParams;
  const statusFilter = sp.status ?? "";
  const categoryFilter = sp.category ?? "";
  const tenantFilter = sp.tenant ?? "";

  let query = admin
    .from("support_requests")
    .select("id, tenant_id, category, subject, status, eta_date, created_at, tenants(name)")
    .order("created_at", { ascending: false })
    .limit(300);
  if (statusFilter) query = query.eq("status", statusFilter);
  if (categoryFilter) query = query.eq("category", categoryFilter);
  if (tenantFilter) query = query.eq("tenant_id", tenantFilter);

  const [{ data: requests }, newCount, { data: tenants }] = await Promise.all([
    query,
    admin
      .from("support_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "nueva"),
    admin.from("tenants").select("id, name").order("name"),
  ]);

  // 'nueva' primero; dentro de cada grupo ya vienen por fecha desc.
  const rows = [...(requests ?? [])].sort(
    (a, b) => Number(b.status === "nueva") - Number(a.status === "nueva")
  );
  const pendingCount = newCount.count ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Solicitudes</h1>
          <p className="text-sm text-neutral-500">
            Sugerencias, reportes y pedidos de cambios de todos los clientes
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            pendingCount > 0 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {pendingCount > 0 ? `${pendingCount} nueva(s)` : "Sin solicitudes nuevas"}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <form method="get" action="/admin/requests" className="flex flex-wrap items-center gap-2">
          <select
            name="status"
            defaultValue={statusFilter}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todos los estados</option>
            {REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            name="category"
            defaultValue={categoryFilter}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todas las categorías</option>
            {REQUEST_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
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
          <button
            type="submit"
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Filtrar
          </button>
        </form>
        {(statusFilter || categoryFilter || tenantFilter) && (
          <Link href="/admin/requests" className="text-xs text-neutral-500 hover:underline">
            Limpiar filtros
          </Link>
        )}
      </div>

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-neutral-400">
            Sin solicitudes para los filtros actuales.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-4 py-2 font-medium">Cliente</th>
                <th className="px-4 py-2 font-medium">Categoría</th>
                <th className="px-4 py-2 font-medium">Asunto</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">Estimada</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tenant = r.tenants as unknown as { name: string } | null;
                return (
                  <tr key={r.id} className="border-t border-neutral-100 align-top">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-500">
                      {new Date(r.created_at).toLocaleString("es-CO")}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-700">
                      <Link href={`/admin/clients/${r.tenant_id}`} className="hover:underline">
                        {tenant?.name ?? r.tenant_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-neutral-600">
                      {CATEGORY_LABELS[r.category as RequestCategory] ?? r.category}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/requests/${r.id}`}
                        className="font-medium text-neutral-900 hover:underline"
                      >
                        {r.subject}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          STATUS_BADGE[r.status as RequestStatus] ??
                          "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {STATUS_LABELS[r.status as RequestStatus] ?? r.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-500">
                      {r.eta_date ? formatEta(r.eta_date) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
