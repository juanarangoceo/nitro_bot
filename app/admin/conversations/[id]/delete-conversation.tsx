"use client";

// Botón de borrado de conversación (solo /admin). Confirmación explícita:
// borra mensajes, tickets y trazas. Pensado para limpiar pruebas internas.

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  deleteConversationAdmin,
  type DeleteConversationState,
} from "../../actions";

const INITIAL: DeleteConversationState = { ok: false, error: null };

export function DeleteConversation({
  conversationId,
  isTest,
}: {
  conversationId: string;
  isTest: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(deleteConversationAdmin, INITIAL);

  useEffect(() => {
    if (state.ok) router.push("/admin/health");
  }, [state.ok, router]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !confirm(
            "Esto borra mensajes, tickets y trazas de esta conversación. No afecta órdenes ya creadas. ¿Continuar?"
          )
        ) {
          e.preventDefault();
        }
      }}
      className="text-right"
    >
      <input type="hidden" name="conversation_id" value={conversationId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "Borrando…" : "Eliminar conversación"}
      </button>
      {!isTest && (
        <p className="mt-1 text-[11px] text-amber-600">
          Ojo: esta conversación NO está marcada como prueba.
        </p>
      )}
      {state.error && <p className="mt-1 text-[11px] text-red-600">{state.error}</p>}
    </form>
  );
}
