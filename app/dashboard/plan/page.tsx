// «Plan» — módulo del dashboard visible SOLO para usuarios con rol admin del
// tenant: plan contratado, consumo, estado del pago (factura pendiente) y los
// datos de pago de la plataforma. Los valores los administra el super-admin
// desde /admin (plan, mensualidad, fecha de corte, estado, paquete adicional).

import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/context";
import {
  ADDON_MESSAGES,
  ADDON_PENDING_DAYS,
  PAYMENT_HOLDER,
  PAYMENT_METHODS,
  billingInfo,
  formatCop,
  formatDueDate,
} from "@/lib/billing";

export default async function PlanPage() {
  const { tenant, role, supabase } = await getDashboardContext();
  if (role !== "admin") redirect("/dashboard");
  if (tenant.modules?.plan === false) redirect("/dashboard");

  const used = tenant.current_month_messages;
  const limit = tenant.message_limit || 1;
  // Con el adicional automático, el ciclo real es plan + 2.000 (entra solo al
  // agotar el plan; genera factura pendiente).
  const addonOn = tenant.addon_enabled === true && tenant.addon_price != null;
  const effective = addonOn ? limit + ADDON_MESSAGES : limit;
  const inAddon = addonOn && used > limit;
  const pct = Math.min(100, Math.round((used / effective) * 100));
  const billing = billingInfo(tenant);
  const paid = billing.status === "pagado";

  // Facturas del cliente (RLS: solo las suyas), las últimas primero.
  const { data: invoiceRows } = await supabase
    .from("invoices")
    .select("id, concept, amount, status, created_at, paid_at")
    .order("created_at", { ascending: false })
    .limit(12);
  const invoices = invoiceRows ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Plan y pagos</h1>
        <p className="text-sm text-neutral-500">
          Tu plan, el consumo del mes y el estado de tu facturación.
        </p>
      </header>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-neutral-500">Plan contratado</p>
            <p className="mt-1 text-2xl font-semibold text-neutral-900">
              {tenant.plan?.trim() || "Plan mensual"}
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              {formatCop(tenant.monthly_fee)} / mes · incluye{" "}
              {limit.toLocaleString("es-CO")} mensajes
            </p>
            {tenant.addon_price != null && (
              <p className="mt-1 text-sm text-neutral-600">
                Paquete adicional: {formatCop(tenant.addon_price)} por{" "}
                {ADDON_MESSAGES.toLocaleString("es-CO")} mensajes extra
                {tenant.addon_enabled
                  ? ` (se activa solo al agotar tu plan; paga su factura dentro de los ${ADDON_PENDING_DAYS} días siguientes)`
                  : ""}
              </p>
            )}
          </div>
          <span
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              pct >= 80 ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-600"
            }`}
          >
            {pct}% usado
          </span>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
          <div
            className={`h-full rounded-full ${
              used >= effective ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-neutral-900"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          {used.toLocaleString("es-CO")} de {effective.toLocaleString("es-CO")} mensajes usados
          en este ciclo{inAddon ? " (tu plan se agotó: estás usando el paquete adicional)" : ""}.
        </p>
        <p className="mt-3 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">
          El pago se realiza en la <strong>fecha de corte</strong> o al{" "}
          <strong>agotar los créditos del plan</strong> — lo que ocurra primero — para que tu
          asistente nunca deje de atender a tus clientes.
        </p>
      </section>

      <section
        className={`rounded-2xl border p-6 ${
          paid
            ? "border-emerald-200 bg-emerald-50"
            : billing.overdue
              ? "border-red-200 bg-red-50"
              : "border-amber-200 bg-amber-50"
        }`}
      >
        <p
          className={`text-sm font-semibold ${
            paid ? "text-emerald-800" : billing.overdue ? "text-red-800" : "text-amber-800"
          }`}
        >
          {paid ? "✅ Estás al día" : billing.overdue ? "🚫 Factura vencida" : "⏳ Factura pendiente"}
        </p>
        <p
          className={`mt-1 text-sm ${
            paid ? "text-emerald-700" : billing.overdue ? "text-red-700" : "text-amber-700"
          }`}
        >
          {paid
            ? `Próxima fecha de corte: ${formatDueDate(billing.dueDate)}.`
            : `Tienes un pago pendiente de ${formatCop(tenant.monthly_fee)} con fecha de corte ${formatDueDate(
                billing.dueDate
              )}. Realiza el pago para no perder el funcionamiento del asistente.`}
        </p>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-neutral-900">Tus facturas</h2>
        {invoices.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">
            Aún no tienes facturas. Se generan automáticamente al acercarse tu fecha de corte
            o al consumir tu plan.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {invoices.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-sm"
              >
                <div>
                  <span className="text-neutral-800">
                    {inv.concept === "renovacion"
                      ? "Renovación del plan"
                      : `Paquete adicional (${ADDON_MESSAGES.toLocaleString("es-CO")} mensajes)`}
                  </span>
                  <span className="ml-2 font-medium text-neutral-900">
                    {formatCop(inv.amount)}
                  </span>
                  <p className="text-[11px] text-neutral-400">
                    {new Date(inv.created_at).toLocaleDateString("es-CO")}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    inv.status === "pagada"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {inv.status === "pagada" ? "Pagada" : "Pendiente"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-neutral-900">Datos para el pago</h2>
        <ul className="mt-3 space-y-2">
          {PAYMENT_METHODS.map((m) => (
            <li
              key={m.label}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-sm"
            >
              <span className="text-neutral-600">{m.label}</span>
              <span className="font-mono font-medium text-neutral-900">{m.value}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-neutral-500">Titular: {PAYMENT_HOLDER}</p>
        <p className="mt-1 text-xs text-neutral-500">
          Después de pagar, envíanos el comprobante por WhatsApp y registramos tu pago el mismo
          día.
        </p>
      </section>
    </div>
  );
}
