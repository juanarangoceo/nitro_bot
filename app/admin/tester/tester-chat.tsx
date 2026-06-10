"use client";

// Chat del probador. Mantiene la lista local; cada envío llama la Server
// Action y agrega el turno + la respuesta. Muestra herramientas usadas,
// imágenes "enviadas" y el resultado de escalamientos simulados.

import { useRef, useState, useTransition } from "react";
import {
  sendTesterMessage,
  resetTesterConversation,
  type TesterState,
  type TesterMessage,
} from "./actions";

type LocalMessage = {
  id: string;
  sender: "customer" | "bot";
  content: string;
  tools?: TesterState["tools"];
  images?: string[];
  exhausted?: boolean;
};

const EMPTY: TesterState = {
  ok: false,
  error: null,
  reply: null,
  tools: [],
  images: [],
  exhausted: false,
};

export function TesterChat({
  tenantId,
  tenantName,
  initialMessages,
}: {
  tenantId: string;
  tenantName: string;
  initialMessages: TesterMessage[];
}) {
  const [messages, setMessages] = useState<LocalMessage[]>(
    initialMessages.map((m) => ({
      id: m.id,
      sender: m.sender === "customer" ? "customer" : "bot",
      content: m.content ?? "",
    }))
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setError(null);
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, sender: "customer", content: trimmed },
    ]);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("tenant_id", tenantId);
      fd.set("message", trimmed);
      const result = await sendTesterMessage(EMPTY, fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}-bot`,
          sender: "bot",
          content: result.reply ?? "(sin texto)",
          tools: result.tools,
          images: result.images,
          exhausted: result.exhausted,
        },
      ]);
    });
  };

  const reset = () => {
    if (!confirm(`¿Borrar los mensajes de la conversación de prueba de ${tenantName}?`)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("tenant_id", tenantId);
      await resetTesterConversation(fd);
      setMessages([]);
      setError(null);
    });
  };

  return (
    <div className="flex min-h-[520px] flex-col rounded-2xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
        <p className="text-sm font-medium text-neutral-900">
          {tenantName} · <span className="text-violet-600">conversación de prueba</span>
        </p>
        <button
          onClick={reset}
          disabled={pending}
          className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
        >
          Reiniciar conversación
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-auto p-4">
        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-neutral-400">
            Escribe como si fueras el cliente final.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
              m.sender === "customer"
                ? "bg-neutral-100 text-neutral-800"
                : "ml-auto bg-neutral-900 text-white"
            }`}
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
            {(m.images ?? []).map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt="imagen de producto" className="mt-2 max-h-48 rounded-lg" />
            ))}
            {m.tools && m.tools.length > 0 && (
              <div className="mt-2 space-y-0.5 border-t border-white/20 pt-1.5">
                {m.tools.map((t, i) => (
                  <p key={i} className="text-[10px] opacity-70">
                    🔧 {t.name} {t.ok ? "✓" : `✗ ${t.error ?? ""}`}
                    {t.name === "escalar_a_humano" && t.ok && " (simulado, sin ticket)"}
                    {t.name === "crear_orden" && t.ok && " (simulada, sin Shopify)"}
                  </p>
                ))}
              </div>
            )}
            {m.exhausted && (
              <p className="mt-1 text-[10px] text-amber-300">
                ⚠️ El loop de herramientas se agotó (en producción esto escalaría a humano).
              </p>
            )}
          </div>
        ))}
        {pending && <p className="text-xs text-neutral-400">El asesor está escribiendo…</p>}
      </div>

      {error && <p className="px-4 pb-2 text-xs text-red-600">{error}</p>}

      <form
        className="flex gap-2 border-t border-neutral-100 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const value = inputRef.current?.value ?? "";
          if (inputRef.current) inputRef.current.value = "";
          send(value);
        }}
      >
        <input
          ref={inputRef}
          placeholder="Mensaje del cliente…"
          disabled={pending}
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
