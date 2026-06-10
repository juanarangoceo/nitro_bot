"use client";

import { useActionState } from "react";
import { changeOwnPassword, type ChangePasswordState } from "./actions";

const INITIAL: ChangePasswordState = { ok: false, error: null };

function Field({
  label,
  name,
  autoComplete,
}: {
  label: string;
  name: string;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      <input
        type="password"
        name={name}
        required
        autoComplete={autoComplete}
        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />
    </label>
  );
}

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changeOwnPassword, INITIAL);

  return (
    <form action={formAction} className="space-y-3">
      <Field label="Contraseña actual" name="current_password" autoComplete="current-password" />
      <Field label="Nueva contraseña (mínimo 8 caracteres)" name="new_password" autoComplete="new-password" />
      <Field label="Repite la nueva contraseña" name="confirm_password" autoComplete="new-password" />

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && (
        <p className="text-sm text-emerald-600">Contraseña actualizada correctamente. ✅</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? "Guardando…" : "Cambiar contraseña"}
      </button>
    </form>
  );
}
