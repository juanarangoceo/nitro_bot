// Banner global de créditos/facturación del dashboard (se renderiza en el
// layout, sobre el contenido). Prioridad: servicio suspendido > créditos
// agotados (modo gracia) > factura vencida > créditos por agotarse (>= 80%).
// El botón "Ver plan y pagos" solo aplica a usuarios con rol admin (el módulo
// /dashboard/plan está restringido).

import Link from "next/link";
import { ADDON_MESSAGES, billingInfo, formatCop, formatDueDate } from "@/lib/billing";
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
  // Con el adicional automático activado, el ciclo real es plan + 2.000.
  const addonOn = tenant.addon_enabled === true && tenant.addon_price != null;
  const effective = addonOn ? limit + ADDON_MESSAGES : limit;
  const pct = Math.min(100, Math.round((used / effective) * 100));
  const billing = billingInfo(tenant);

  // La renovación con monto concreto persuade más que el aviso genérico.
  const renewalAmount =
    tenant.monthly_fee != null ? ` (${formatCop(tenant.monthly_fee)})` : "";

  let tone: "red" | "amber" | null = null;
  let message = "";
  if (tenant.service_paused) {
    tone = "red";
    message =
      "El servicio de tu asistente está suspendido por un pago pendiente y tus clientes no están recibiendo respuesta. Realiza el pago y avísanos para reactivarlo de inmediato.";
  } else if (used >= effective) {
    // Modo gracia: el bot sigue respondiendo mientras se registra el pago —
    // urgente pero amable (decisión 2026-07-19). Los mensajes atendidos en
    // gracia se descuentan del próximo ciclo, y el banner lo dice.
    tone = "red";
    message = `Los créditos de tu ciclo se agotaron y tu asistente sigue atendiendo a tus clientes; esos mensajes se descontarán de tu próximo plan. Realiza hoy el pago de tu renovación${renewalAmount} para conservar el servicio sin interrupciones.`;
  } else if (used >= limit && addonOn) {
    tone = "amber";
    message = `Se agotó tu plan y el asistente sigue atendiendo con el paquete adicional de ${ADDON_MESSAGES.toLocaleString(
      "es-CO"
    )} mensajes (queda una factura pendiente). Realiza el pago para renovar tu plan.`;
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
