"use client";

import { useActionState, useRef, useEffect } from "react";
import { addComment, closeRequest, type RequestFormState } from "../actions";

type Comment = {
  id: string;
  author_role: string;
  body: string;
  created_at: string;
};

const init: RequestFormState = { ok: false, error: null };

export function RequestThread({
  requestId,
  comments,
  canClose,
}: {
  requestId: string;
  comments: Comment[];
  canClose: boolean;
}) {
  const [state, action, pending] = useActionState(addComment, init);
  const formRef = useRef<HTMLFormElement>(null);

  // Limpia el textarea cuando el comentario se guardó.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-neutral-200 bg-white p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          Conversación
        </p>

        <div className="mt-3 space-y-3">
          {comments.map((c) => {
            const isClient = c.author_role === "client";
            return (
              <div key={c.id} className={`flex ${isClient ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                    isClient
                      ? "bg-(--brand) text-white"
                      : "bg-neutral-100 text-neutral-800"
                  }`}
                >
                  <p className={`text-[11px] ${isClient ? "text-white/70" : "text-neutral-400"}`}>
                    {isClient ? "Tú" : "Soporte Nitro"} ·{" "}
                    {new Date(c.created_at).toLocaleString("es-CO")}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
                </div>
              </div>
            );
          })}
          {comments.length === 0 && (
            <p className="py-4 text-center text-sm text-neutral-400">
              Aún no hay comentarios. Si quieres agregar contexto, escríbenos aquí.
            </p>
          )}
        </div>

        <form ref={formRef} action={action} className="mt-4 space-y-2">
          <input type="hidden" name="request_id" value={requestId} />
          <textarea
            name="body"
            required
            rows={3}
            placeholder="Escribe un comentario…"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
            >
              {pending ? "Enviando…" : "Comentar"}
            </button>
            {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          </div>
        </form>
      </div>

      {canClose && (
        <form
          action={closeRequest}
          onSubmit={(e) => {
            if (!confirm("¿Cerrar esta solicitud? Quedará marcada como que ya no la necesitas.")) {
              e.preventDefault();
            }
          }}
          className="flex justify-end"
        >
          <input type="hidden" name="request_id" value={requestId} />
          <button
            type="submit"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100"
          >
            Ya no la necesito — cerrar solicitud
          </button>
        </form>
      )}
    </div>
  );
}
