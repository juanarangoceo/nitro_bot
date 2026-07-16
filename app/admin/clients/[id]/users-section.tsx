"use client";

// Usuarios del dashboard del tenant + restablecer contraseña.
// La contraseña temporal se muestra UNA SOLA VEZ (vive solo en el estado de
// la acción); recargar la página la pierde — por diseño.

import { useActionState } from "react";
import {
  createDashboardUser,
  deleteDashboardUser,
  resetUserPassword,
  updateUserName,
  type CreateUserState,
  type DeleteUserState,
  type ResetPasswordState,
  type UpdateUserNameState,
} from "../../actions";

export type TenantUser = {
  id: string;
  email: string | null;
  name: string | null;
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

const DELETE_INITIAL: DeleteUserState = { ok: false, error: null };

function DeleteButton({ user }: { user: TenantUser }) {
  const [state, formAction, pending] = useActionState(deleteDashboardUser, DELETE_INITIAL);

  return (
    <div className="text-right">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (
            !confirm(
              `¿Eliminar a ${user.email ?? "este usuario"}? Perderá el acceso al dashboard definitivamente.`
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="user_id" value={user.id} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {pending ? "Eliminando…" : "Eliminar"}
        </button>
      </form>
      {state.error && <p className="mt-1 text-[11px] text-red-600">{state.error}</p>}
    </div>
  );
}

const NAME_INITIAL: UpdateUserNameState = { ok: false, error: null };

// Nombre visible del usuario: identifica quién respondió cada mensaje en el
// dashboard del cliente. Vacío = se muestra el correo.
function NameForm({ user }: { user: TenantUser }) {
  const [state, formAction, pending] = useActionState(updateUserName, NAME_INITIAL);

  return (
    <form action={formAction} className="mt-1 flex items-center gap-2">
      <input type="hidden" name="user_id" value={user.id} />
      <input
        type="text"
        name="name"
        defaultValue={user.name ?? ""}
        placeholder="Nombre visible"
        maxLength={80}
        className="w-44 rounded-lg border border-neutral-300 px-2 py-1 text-xs"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-neutral-300 px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
      >
        {pending ? "Guardando…" : "Guardar"}
      </button>
      {state.ok && <span className="text-[11px] text-emerald-600">✓</span>}
      {state.error && <span className="text-[11px] text-red-600">{state.error}</span>}
    </form>
  );
}

const CREATE_INITIAL: CreateUserState = {
  ok: false,
  error: null,
  tempPassword: null,
  email: null,
};

function CreateUserForm({ tenantId }: { tenantId: string }) {
  const [state, formAction, pending] = useActionState(createDashboardUser, CREATE_INITIAL);

  return (
    <div className="border-t border-neutral-100 pt-4">
      <p className="mb-2 text-xs font-medium text-neutral-500">Agregar usuario</p>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="tenant_id" value={tenantId} />
        <input
          type="email"
          name="email"
          required
          placeholder="correo@cliente.com"
          className="min-w-52 flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <input
          type="text"
          name="name"
          placeholder="Nombre (opcional)"
          maxLength={80}
          className="min-w-40 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <select
          name="role"
          defaultValue="agent"
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
        >
          <option value="agent">Agente</option>
          <option value="admin">Administrador</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {pending ? "Creando…" : "Crear usuario"}
        </button>
      </form>
      {state.ok && state.tempPassword && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
          <p className="text-[11px] text-amber-800">
            Usuario {state.email} creado. Contraseña temporal (cópiala ahora, no se
            vuelve a mostrar):
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

export function UsersSection({ tenantId, users }: { tenantId: string; users: TenantUser[] }) {
  return (
    <div className="space-y-4">
      {users.length === 0 ? (
        <p className="text-sm text-neutral-400">Este cliente no tiene usuarios de dashboard.</p>
      ) : (
        <ul className="space-y-3">
          {users.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-3 last:border-0 last:pb-0"
            >
              <div>
                <p className="text-sm text-neutral-800">
                  {u.name ? `${u.name} · ` : ""}
                  {u.email ?? "—"}
                </p>
                <p className="text-[11px] text-neutral-400">
                  rol: {u.role} · último ingreso:{" "}
                  {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString("es-CO") : "nunca"}
                </p>
                <NameForm user={u} />
              </div>
              <div className="flex items-start gap-2">
                <ResetButton user={u} />
                <DeleteButton user={u} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <CreateUserForm tenantId={tenantId} />
    </div>
  );
}
