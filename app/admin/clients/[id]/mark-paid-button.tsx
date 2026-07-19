"use client";

// Botón «Marcar pagada» con confirmación explícita: pagar una RENOVACIÓN
// reinicia el ciclo (contador a 0, corte a hoy + 1 mes) — usarlo solo cuando
// el cliente pagó de verdad (aprendizaje del 2026-07-17: se usó dos veces
// para "despausar"/limpiar la vista y regaló ciclos).

import { deleteManualInvoice, markInvoicePaidAdmin } from "../../actions";

export function MarkPaidButton({
  invoiceId,
  tenantId,
  concept,
}: {
  invoiceId: string;
  tenantId: string;
  concept: string;
}) {
  const warning =
    concept === "renovacion"
      ? "¿El cliente YA PAGÓ la renovación?\n\nSi ya agotó sus créditos (o llegó el corte), el ciclo nuevo arranca YA: contador a 0 y corte a hoy + 1 mes.\n\nSi todavía le quedan créditos, el pago queda PROGRAMADO: el ciclo nuevo arranca solo al agotarlos o al llegar el corte, lo que ocurra primero.\n\nSi el bot estaba suspendido por pago, se reactiva automáticamente.\n\nSi NO ha pagado de verdad, cancela: no uses este botón."
      : concept === "adicional"
        ? "¿El cliente ya pagó el paquete adicional?\n\nEsto solo registra el pago (no reinicia el contador)."
        : "¿El cliente ya pagó esta factura?\n\nEsto solo registra el pago (no toca el plan ni el ciclo de mensajes).";

  return (
    <form
      action={markInvoicePaidAdmin}
      onSubmit={(e) => {
        if (!confirm(warning)) e.preventDefault();
      }}
    >
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input type="hidden" name="tenant_id" value={tenantId} />
      <button
        type="submit"
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
      >
        Marcar pagada
      </button>
    </form>
  );
}

// Eliminar una factura MANUAL pendiente (creada por error). Las automáticas y
// las pagadas no se tocan — la action lo re-verifica server-side.
export function DeleteManualInvoiceButton({
  invoiceId,
  tenantId,
}: {
  invoiceId: string;
  tenantId: string;
}) {
  return (
    <form
      action={deleteManualInvoice}
      onSubmit={(e) => {
        if (!confirm("¿Eliminar esta factura manual? El cliente dejará de verla en su módulo Plan.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input type="hidden" name="tenant_id" value={tenantId} />
      <button
        type="submit"
        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
      >
        Eliminar
      </button>
    </form>
  );
}
