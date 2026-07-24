"use client";

import { useActionState } from "react";
import {
  updatePaymentSettings,
  type PaymentSettingsState,
} from "@/app/admin/actions";
import type { PaymentSettings } from "@/lib/platform/payment-settings";

const INITIAL: PaymentSettingsState = { ok: false, error: null };

export function PaymentSettingsForm({
  settings,
}: {
  settings: PaymentSettings;
}) {
  const [state, action, pending] = useActionState(updatePaymentSettings, INITIAL);
  const rows = Array.from({ length: 5 }, (_, index) => settings.methods[index]);

  return (
    <form action={action} className="space-y-6">
      <label className="block">
        <span className="text-sm font-medium text-neutral-700">Titular</span>
        <input
          name="payment_holder"
          defaultValue={settings.holder}
          required
          maxLength={160}
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        />
      </label>

      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Medios de pago</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Puedes publicar hasta cinco cuentas, llaves o billeteras. Las filas vacías no se
            muestran al cliente.
          </p>
        </div>
        {rows.map((method, index) => (
          <div
            key={index}
            className="grid gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-2"
          >
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Nombre del medio {index + 1}
              </span>
              <input
                name={`method_label_${index}`}
                defaultValue={method?.label ?? ""}
                maxLength={80}
                placeholder="Ej. Nequi / Llave"
                className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Número, llave o cuenta
              </span>
              <input
                name={`method_value_${index}`}
                defaultValue={method?.value ?? ""}
                maxLength={120}
                placeholder="Ej. 300 000 0000"
                className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-neutral-900"
              />
            </label>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
        >
          {pending ? "Guardando…" : "Guardar datos de pago"}
        </button>
        {state.ok && <span className="text-sm text-emerald-600">Guardado ✅</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
