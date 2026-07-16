"use client";

import { useActionState } from "react";
import {
  createLabel,
  renameLabel,
  setLabelActive,
  deleteLabel,
  setUserLabels,
  type LabelFormState,
} from "./actions";

const init: LabelFormState = { ok: false, error: null };

export type LabelRow = {
  id: string;
  name: string;
  is_active: boolean;
  open_tickets: number;
};

export type TeamUser = {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  label_ids: string[];
};

export function NewLabelForm() {
  const [state, action, pending] = useActionState(createLabel, init);
  return (
    <form action={action} className="flex items-center gap-2">
      <input
        type="text"
        name="name"
        required
        maxLength={60}
        placeholder="Nueva etiqueta (ej. Mayoristas)"
        className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
      >
        {pending ? "Creando…" : "Crear"}
      </button>
      {state.error && <span className="text-sm text-red-600">{state.error}</span>}
    </form>
  );
}

export function LabelItem({ label }: { label: LabelRow }) {
  const [state, action, pending] = useActionState(renameLabel, init);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3">
      <form action={action} className="flex flex-1 items-center gap-2">
        <input type="hidden" name="label_id" value={label.id} />
        <input
          type="text"
          name="name"
          defaultValue={label.name}
          maxLength={60}
          className={`flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm ${
            label.is_active ? "" : "text-neutral-400"
          }`}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
        >
          {pending ? "Guardando…" : "Renombrar"}
        </button>
      </form>

      <span className="text-xs text-neutral-500">
        {label.open_tickets} ticket{label.open_tickets === 1 ? "" : "s"} abierto
        {label.open_tickets === 1 ? "" : "s"}
      </span>

      {!label.is_active && (
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500">
          Inactiva
        </span>
      )}

      <form action={setLabelActive}>
        <input type="hidden" name="label_id" value={label.id} />
        <input type="hidden" name="active" value={label.is_active ? "false" : "true"} />
        <button
          type="submit"
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
        >
          {label.is_active ? "Desactivar" : "Activar"}
        </button>
      </form>

      <form
        action={deleteLabel}
        onSubmit={(e) => {
          const msg =
            label.open_tickets > 0
              ? `Esta etiqueta tiene ${label.open_tickets} ticket(s) abierto(s); quedarán sin etiqueta (visibles para todo el equipo). Si solo quieres pausarla, usa "Desactivar". ¿Eliminar de todas formas?`
              : "¿Eliminar esta etiqueta? Las asignaciones a tu equipo también se eliminan.";
          if (!confirm(msg)) e.preventDefault();
        }}
      >
        <input type="hidden" name="label_id" value={label.id} />
        <button
          type="submit"
          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
        >
          Eliminar
        </button>
      </form>

      {state.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
    </div>
  );
}

// Matriz de asignación de un usuario: checkboxes de etiquetas + guardar.
export function UserLabelsForm({
  user,
  labels,
}: {
  user: TeamUser;
  labels: LabelRow[];
}) {
  const [state, action, pending] = useActionState(setUserLabels, init);
  return (
    <form
      action={action}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-neutral-200 bg-white p-3"
    >
      <input type="hidden" name="user_id" value={user.id} />
      <div className="min-w-48">
        <p className="text-sm font-medium text-neutral-900">
          {user.name ?? user.email ?? user.id}
          {user.name && user.email && (
            <span className="ml-1 font-normal text-neutral-400">· {user.email}</span>
          )}
        </p>
        <p className="text-xs text-neutral-500">
          Sin etiquetas seleccionadas ve todos los tickets.
        </p>
      </div>
      {labels.map((l) => (
        <label key={l.id} className="flex items-center gap-1.5 text-sm text-neutral-700">
          <input
            type="checkbox"
            name="label_ids"
            value={l.id}
            defaultChecked={user.label_ids.includes(l.id)}
            className="h-4 w-4 rounded border-neutral-300"
          />
          {l.name}
        </label>
      ))}
      <button
        type="submit"
        disabled={pending}
        className="ml-auto rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
      >
        {pending ? "Guardando…" : state.ok ? "Guardado ✓" : "Guardar"}
      </button>
      {state.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
