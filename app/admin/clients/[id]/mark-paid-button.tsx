"use client";

// Botón «Marcar pagada» con confirmación explícita: pagar una RENOVACIÓN
// reinicia el ciclo (contador a 0, corte a hoy + 1 mes) — usarlo solo cuando
// el cliente pagó de verdad (aprendizaje del 2026-07-17: se usó dos veces
// para "despausar"/limpiar la vista y regaló ciclos).

import { markInvoicePaidAdmin } from "../../actions";

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
      ? "¿El cliente YA PAGÓ la renovación?\n\nEsto reinicia su ciclo: contador a 0, créditos completos del plan y fecha de corte a hoy + 1 mes.\n\nSi solo quieres quitar una alerta o despausar el bot SIN pago real, cancela: NO uses este botón."
      : "¿El cliente ya pagó el paquete adicional?\n\nEsto solo registra el pago (no reinicia el contador).";

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
