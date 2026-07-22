"use client";

import { useActionState } from "react";
import { blockNumber, unblockNumber, type BlockFormState } from "./actions";

export type BlockedRow = {
  id: string;
  phone: string;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
};

const init: BlockFormState = { ok: false, error: null };

export function NewBlockForm() {
  const [state, action, pending] = useActionState(blockNumber, init);

  return (
    <form action={action} className="rounded-2xl border border-neutral-200 bg-white p-4">
      <p className="text-sm font-medium text-neutral-900">Bloquear un número</p>
      <p className="mt-1 text-xs text-neutral-500">
        El asesor dejará de responderle por completo (tampoco recibirá recordatorios ni
        mensajes de carrito). Sus mensajes no descuentan de tu plan.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          name="phone"
          placeholder="Ej: 3001234567"
          className="w-44 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        />
        <input
          name="note"
          placeholder="Motivo (opcional)"
          className="min-w-52 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
        >
          {pending ? "Bloqueando…" : "Bloquear"}
        </button>
      </div>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="mt-2 text-sm text-green-700">Número bloqueado.</p>}
    </form>
  );
}

export function BlockedList({ rows }: { rows: BlockedRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400">
        No hay números bloqueados.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
            <th className="px-4 py-3 font-medium">Número</th>
            <th className="px-4 py-3 font-medium">Motivo</th>
            <th className="px-4 py-3 font-medium">Bloqueado</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-neutral-50 last:border-0">
              <td className="px-4 py-3 font-medium text-neutral-900">{r.phone}</td>
              <td className="px-4 py-3 text-neutral-600">{r.note ?? "—"}</td>
              <td className="px-4 py-3 text-xs text-neutral-500">
                {new Date(r.created_at).toLocaleDateString("es-CO")}
                {r.created_by_name ? ` · ${r.created_by_name}` : ""}
              </td>
              <td className="px-4 py-3 text-right">
                <form
                  action={unblockNumber}
                  onSubmit={(e) => {
                    if (!confirm(`¿Desbloquear ${r.phone}? El asesor volverá a responderle.`))
                      e.preventDefault();
                  }}
                >
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    type="submit"
                    className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
                  >
                    Desbloquear
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
