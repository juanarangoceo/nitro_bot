"use client";

import { useActionState } from "react";
import { createRequest, type RequestFormState } from "../actions";
import { CATEGORY_LABELS, REQUEST_CATEGORIES } from "@/lib/support/labels";

const init: RequestFormState = { ok: false, error: null };

export function NewRequestForm() {
  const [state, action, pending] = useActionState(createRequest, init);

  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Categoría</span>
        <select
          name="category"
          required
          defaultValue="ajuste_asesor"
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        >
          {REQUEST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Asunto</span>
        <input
          type="text"
          name="subject"
          required
          maxLength={120}
          placeholder="Resumen corto de lo que necesitas"
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Descripción</span>
        <textarea
          name="description"
          required
          rows={6}
          placeholder="Describe con detalle: qué esperas que haga el asesor, qué pasó, ejemplos…"
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
        >
          {pending ? "Enviando…" : "Enviar solicitud"}
        </button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
