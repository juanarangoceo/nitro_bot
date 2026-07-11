import Link from "next/link";
import { getDashboardContext } from "@/lib/dashboard/context";
import {
  CATEGORY_LABELS,
  STATUS_BADGE,
  STATUS_LABELS,
  formatEta,
  type RequestCategory,
  type RequestStatus,
} from "@/lib/support/labels";

export default async function RequestsPage() {
  const { supabase } = await getDashboardContext();

  const { data: requests } = await supabase
    .from("support_requests")
    .select("id, category, subject, status, eta_date, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = requests ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Solicitudes</h1>
          <p className="text-sm text-neutral-500">
            Pide ajustes del asesor, reporta errores o déjanos sugerencias. Te
            avisamos por correo cuando haya novedades.
          </p>
        </div>
        <Link
          href="/dashboard/requests/new"
          className="rounded-lg bg-(--brand) px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Nueva solicitud
        </Link>
      </header>

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Asunto</th>
              <th className="px-4 py-3 font-medium">Categoría</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Creada</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <tr key={r.id} className="text-neutral-800">
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/requests/${r.id}`}
                    className="font-medium hover:underline"
                  >
                    {r.subject}
                  </Link>
                  {r.eta_date && (
                    <p className="text-xs text-neutral-500">
                      Implementación estimada: {formatEta(r.eta_date)}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {CATEGORY_LABELS[r.category as RequestCategory] ?? r.category}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      STATUS_BADGE[r.status as RequestStatus] ?? "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {STATUS_LABELS[r.status as RequestStatus] ?? r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-neutral-500">
                  {new Date(r.created_at).toLocaleDateString("es-CO")}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-neutral-400">
                  No tienes solicitudes. Crea una para pedir ajustes, reportar
                  algo o dejarnos una sugerencia.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
