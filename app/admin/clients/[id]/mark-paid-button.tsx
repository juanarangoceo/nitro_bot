"use client";

// Botón «Marcar pagada» con confirmación explícita: pagar una RENOVACIÓN
// reinicia el ciclo (contador arranca en el excedente de gracia consumido —
// 0 si no lo hubo —, corte a hoy + 1 mes) — usarlo solo cuando el cliente
// pagó de verdad (aprendizaje del 2026-07-17: se usó dos veces para
// "despausar"/limpiar la vista y regaló ciclos).

import { deleteInvoice, markInvoicePaidAdmin } from "../../actions";

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
      ? "¿El cliente YA PAGÓ la renovación?\n\nSi ya agotó sus créditos (o llegó el corte), el ciclo nuevo arranca YA: el contador arranca con los mensajes de gracia ya descontados (0 si no consumió de más) y corte a hoy + 1 mes.\n\nSi todavía le quedan créditos, el pago queda PROGRAMADO: el ciclo nuevo arranca solo al agotarlos o al llegar el corte, lo que ocurra primero.\n\nSi el bot estaba suspendido por pago, se reactiva automáticamente.\n\nSi NO ha pagado de verdad, cancela: no uses este botón."
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

// Eliminar una factura PENDIENTE (manual, renovación o adicional). Las pagadas
// son historial contable y no se tocan — la action lo re-verifica server-side.
// Anular la renovación sirve cuando su monto quedó obsoleto (p. ej. el cliente
// pasó a un plan más grande a mitad de ciclo): el sistema volverá a generarla
// con el precio vigente al 80% de consumo o a ≤10 días del corte.
export function DeleteInvoiceButton({
  invoiceId,
  tenantId,
  concept,
}: {
  invoiceId: string;
  tenantId: string;
  concept: string;
}) {
  const warning =
    concept === "manual"
      ? "¿Eliminar esta factura manual? El cliente dejará de verla en su módulo Plan."
      : concept === "renovacion"
        ? "¿Anular esta factura de renovación?\n\nÚsalo cuando su monto quedó obsoleto (por ejemplo, tras subir al cliente de plan).\n\nEl cliente dejará de verla y el sistema volverá a generarla con el precio VIGENTE cuando cruce el 80% de su ciclo o falten 10 días para el corte.\n\nNo afecta el contador de mensajes."
        : "¿Anular esta factura del paquete adicional?\n\nEl cliente dejará de verla. No afecta el contador de mensajes.";

  return (
    <form
      action={deleteInvoice}
      onSubmit={(e) => {
        if (!confirm(warning)) e.preventDefault();
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
