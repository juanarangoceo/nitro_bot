"use client";

// Usuarios del dashboard del tenant + restablecer contraseña.
// La contraseña temporal se muestra UNA SOLA VEZ (vive solo en el estado de
// la acción); recargar la página la pierde — por diseño.

import { useActionState } from "react";
import { resetUserPassword, type ResetPasswordState } from "../../actions";

export type TenantUser = {
  id: string;
  email: string | null;
  role: string;
  lastSignInAt: string | null;
};

const INITIAL: ResetPasswordState = { ok: false, error: null, tempPassword: null, email: null };

function ResetButton({ user }: { user: TenantUser }) {
  const [state, formAction, pending] = useActionState(resetUserPassword, INITIAL);

  return (
    <div className="text-right">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!confirm(`¿Restablecer la contraseña de ${user.email ?? "este usuario"}?`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="user_id" value={user.id} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          {pending ? "Generando…" : "Restablecer contraseña"}
        </button>
      </form>
      {state.ok && state.tempPassword && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-left">
          <p className="text-[11px] text-amber-800">
            Contraseña temporal (cópiala ahora, no se vuelve a mostrar):
          </p>
          <code className="mt-1 block select-all rounded bg-white px-2 py-1 text-sm font-semibold text-neutral-900">
            {state.tempPassword}
          </code>
        </div>
      )}
      {state.error && <p className="mt-1 text-[11px] text-red-600">{state.error}</p>}
    </div>
  );
}

export function UsersSection({ users }: { users: TenantUser[] }) {
  if (users.length === 0) {
    return <p className="text-sm text-neutral-400">Este cliente no tiene usuarios de dashboard.</p>;
  }
  return (
    <ul className="space-y-3">
      {users.map((u) => (
        <li
          key={u.id}
          className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-3 last:border-0 last:pb-0"
        >
          <div>
            <p className="text-sm text-neutral-800">{u.email ?? "—"}</p>
            <p className="text-[11px] text-neutral-400">
              rol: {u.role} · último ingreso:{" "}
              {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString("es-CO") : "nunca"}
            </p>
          </div>
          <ResetButton user={u} />
        </li>
      ))}
    </ul>
  );
}
