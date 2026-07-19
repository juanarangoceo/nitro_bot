"use client";

// Botón «Suspender bot por pago» / «Reactivar bot» con confirmación explícita.
// Es la palanca de cobro MANUAL (decisión 2026-07-19: la pausa por falta de
// pago ya no es automática). Distinto de «Pausar cliente» (is_active), que
// apaga el tenant completo.

import { setServicePaused } from "../../actions";

export function ServicePausedButton({
  tenantId,
  paused,
}: {
  tenantId: string;
  paused: boolean;
}) {
  const warning = paused
    ? "¿Reactivar el bot?\n\nVolverá a responder a los clientes de inmediato. El contador y el ciclo de facturación no se tocan."
    : "¿Suspender el bot por pago pendiente?\n\nEl bot dejará de responder a los clientes finales (silencio total, sin consumir mensajes) y el dashboard del cliente mostrará el aviso de suspensión. Los números de prueba siguen funcionando.\n\nSe reactiva con este mismo botón o automáticamente al «Marcar pagada» la renovación.";

  return (
    <form
      action={setServicePaused}
      onSubmit={(e) => {
        if (!confirm(warning)) e.preventDefault();
      }}
    >
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="paused" value={(!paused).toString()} />
      <button
        type="submit"
        className={`rounded-lg px-4 py-2 text-sm font-medium ${
          paused
            ? "bg-emerald-600 text-white hover:bg-emerald-700"
            : "bg-red-600 text-white hover:bg-red-700"
        }`}
      >
        {paused ? "Reactivar bot" : "Suspender bot por pago"}
      </button>
    </form>
  );
}
