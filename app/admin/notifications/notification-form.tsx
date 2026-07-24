"use client";

import { useActionState } from "react";
import {
  createClientNotification,
  type NotificationAdminState,
} from "./actions";

const INITIAL: NotificationAdminState = { ok: false, error: null };

export function NotificationForm({
  tenants,
}: {
  tenants: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createClientNotification, INITIAL);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-neutral-600">Destinatario</span>
          <select
            name="tenant_id"
            required
            defaultValue=""
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="" disabled>Seleccionar…</option>
            <option value="all">Todos los clientes activos</option>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-neutral-600">Prioridad</span>
          <select
            name="tone"
            defaultValue="info"
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="info">Información</option>
            <option value="warning">Importante</option>
            <option value="urgent">Urgente</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Título</span>
        <input
          name="title"
          required
          maxLength={100}
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Mensaje</span>
        <textarea
          name="body"
          required
          maxLength={1200}
          rows={5}
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? "Publicando…" : "Publicar notificación"}
        </button>
        {state.ok && <span className="text-sm text-emerald-600">Publicada ✓</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
