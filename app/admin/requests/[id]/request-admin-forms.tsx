"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  replyToRequest,
  updateRequestStatus,
  type AdminRequestState,
} from "../actions";
import { REQUEST_STATUSES, STATUS_LABELS, type RequestStatus } from "@/lib/support/labels";

const init: AdminRequestState = { ok: false, error: null };

// El cierre propio ('cerrada_por_cliente') no es asignable por la plataforma.
const ADMIN_STATUSES = REQUEST_STATUSES.filter((s) => s !== "cerrada_por_cliente");

export function RequestAdminForms({
  requestId,
  currentStatus,
  currentEta,
  currentRejectionNote,
}: {
  requestId: string;
  currentStatus: RequestStatus;
  currentEta: string | null;
  currentRejectionNote: string | null;
}) {
  const [statusState, statusAction, statusPending] = useActionState(updateRequestStatus, init);
  const [replyState, replyAction, replyPending] = useActionState(replyToRequest, init);
  const [selectedStatus, setSelectedStatus] = useState<string>(currentStatus);
  const replyRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (replyState.ok) replyRef.current?.reset();
  }, [replyState]);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form action={statusAction} className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          Gestión
        </p>
        <input type="hidden" name="request_id" value={requestId} />

        <label className="block">
          <span className="text-xs font-medium text-neutral-600">Estado</span>
          <select
            name="status"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            {ADMIN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
            {currentStatus === "cerrada_por_cliente" && (
              <option value="cerrada_por_cliente" disabled>
                {STATUS_LABELS.cerrada_por_cliente} (por el cliente)
              </option>
            )}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-neutral-600">
            Fecha estimada de implementación (opcional)
          </span>
          <input
            type="date"
            name="eta_date"
            defaultValue={currentEta ?? ""}
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
          <span className="text-[11px] text-neutral-400">
            Siempre se muestra al cliente como «estimada». Déjala vacía para quitarla.
          </span>
        </label>

        {selectedStatus === "rechazada" && (
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Motivo del rechazo (el cliente lo verá — tono amable)
            </span>
            <textarea
              name="rejection_note"
              required
              rows={3}
              defaultValue={currentRejectionNote ?? ""}
              className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            />
          </label>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={statusPending}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
          >
            {statusPending ? "Guardando…" : "Guardar"}
          </button>
          {statusState.ok && <span className="text-sm text-emerald-600">Guardado ✅</span>}
          {statusState.error && <span className="text-sm text-red-600">{statusState.error}</span>}
        </div>
        <p className="text-[11px] text-neutral-400">
          Si el estado cambia, el cliente recibe un correo automáticamente.
        </p>
      </form>

      <form
        ref={replyRef}
        action={replyAction}
        className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-6"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          Responder al cliente
        </p>
        <input type="hidden" name="request_id" value={requestId} />
        <textarea
          name="body"
          required
          rows={5}
          placeholder="Tu respuesta aparecerá en el hilo del cliente y le llegará por correo…"
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={replyPending}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
          >
            {replyPending ? "Enviando…" : "Responder"}
          </button>
          {replyState.ok && <span className="text-sm text-emerald-600">Enviada ✅</span>}
          {replyState.error && <span className="text-sm text-red-600">{replyState.error}</span>}
        </div>
      </form>
    </div>
  );
}
