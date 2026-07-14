// Banner global de créditos/facturación del dashboard (se renderiza en el
// layout, sobre el contenido). Prioridad: créditos agotados > factura vencida >
// créditos por agotarse (>= 80%). El botón "Ver plan y pagos" solo aplica a
// usuarios con rol admin (el módulo /dashboard/plan está restringido).

import Link from "next/link";
import { billingInfo, formatDueDate } from "@/lib/billing";
import type { DashboardTenant } from "@/lib/dashboard/context";

export function BillingAlert({
  tenant,
  isAdmin,
}: {
  tenant: DashboardTenant;
  isAdmin: boolean;
}) {
  const used = tenant.current_month_messages;
  const limit = tenant.message_limit || 1;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const billing = billingInfo(tenant);

  let tone: "red" | "amber" | null = null;
  let message = "";
  if (used >= limit) {
    tone = "red";
    message =
      "Se agotaron los créditos de tu plan este mes y el asistente dejó de responder a tus clientes. Recarga ahora para reactivar el servicio.";
  } else if (billing.overdue) {
    tone = "red";
    message = `Tienes una factura pendiente vencida (fecha de corte: ${formatDueDate(
      billing.dueDate
    )}). Realiza el pago para no perder el funcionamiento del asistente.`;
  } else if (pct >= 80) {
    tone = "amber";
    message = `Has usado el ${pct}% de los créditos de tu plan este mes. Recuerda recargar a tiempo para no quedarte sin el servicio.`;
  }
  if (!tone) return null;

  const styles =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-amber-200 bg-amber-50 text-amber-800";

  return (
    <div
      className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${styles}`}
    >
      <p>
        {tone === "red" ? "🚫" : "⚠️"} {message}
      </p>
      {isAdmin ? (
        <Link
          href="/dashboard/plan"
          className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-white ${
            tone === "red" ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"
          }`}
        >
          Ver plan y pagos
        </Link>
      ) : (
        <span className="text-xs opacity-80">
          El administrador de tu cuenta puede ver el plan y los datos de pago.
        </span>
      )}
    </div>
  );
}
