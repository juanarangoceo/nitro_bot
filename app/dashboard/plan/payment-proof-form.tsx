"use client";

import { useActionState } from "react";
import {
  submitPaymentProof,
  type PaymentProofState,
} from "./actions";

const INITIAL: PaymentProofState = { ok: false, error: null };

export function PaymentProofForm({
  invoiceId,
  alreadyUploaded,
}: {
  invoiceId: string;
  alreadyUploaded: boolean;
}) {
  const [state, action, pending] = useActionState(submitPaymentProof, INITIAL);

  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <label className="block max-w-xs">
        <span className="sr-only">
          {alreadyUploaded ? "Reemplazar comprobante" : "Adjuntar comprobante"}
        </span>
        <input
          name="proof"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          className="w-full text-xs text-neutral-600 file:mr-2 file:rounded-lg file:border file:border-neutral-300 file:bg-white file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-neutral-700 hover:file:bg-neutral-100"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? "Enviando…" : "Enviar"}
      </button>
      {alreadyUploaded && !state.ok && (
        <span className="text-xs text-emerald-700">Comprobante enviado ✓</span>
      )}
      {state.ok && (
        <span className="text-xs text-emerald-700">Recibido; validaremos el pago ✓</span>
      )}
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
