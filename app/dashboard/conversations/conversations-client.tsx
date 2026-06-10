"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { closeConversation } from "./actions";

export type ConversationRow = {
  id: string;
  customer_phone: string;
  status: string;
  last_customer_message_at: string | null;
  created_at: string;
};

type Message = {
  id: string;
  sender: string;
  content: string | null;
  msg_type: string;
  media_path: string | null;
  media_url: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  bot_active: { text: "Bot", cls: "bg-emerald-100 text-emerald-700" },
  requires_human: { text: "Requiere humano", cls: "bg-amber-100 text-amber-700" },
  human_active: { text: "Humano", cls: "bg-blue-100 text-blue-700" },
  closed: { text: "Cerrada", cls: "bg-neutral-200 text-neutral-600" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { text: status, cls: "bg-neutral-100 text-neutral-600" };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] ${s.cls}`}>{s.text}</span>;
}

// Renderiza el contenido del mensaje según su tipo. La media se sirve por el
// route handler /dashboard/media/[id] (firma URLs del bucket privado).
function MessageBody({ m }: { m: Message }) {
  const hasMedia = m.media_path || m.media_url;
  if (m.msg_type === "image" && hasMedia) {
    return (
      <div className="space-y-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/dashboard/media/${m.id}`}
          alt={m.content ?? "imagen"}
          className="max-h-60 rounded-lg"
        />
        {m.content && m.content !== "[imagen]" && <p>{m.content}</p>}
      </div>
    );
  }
  if (m.msg_type === "audio" && hasMedia) {
    return <audio controls src={`/dashboard/media/${m.id}`} className="max-w-full" />;
  }
  return <p className="whitespace-pre-wrap">{m.content}</p>;
}

export function ConversationsClient({
  initialConversations,
}: {
  initialConversations: ConversationRow[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ConversationRow | null>(
    initialConversations[0] ?? null
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const supabaseRef = useRef<ReturnType<typeof createBrowserSupabase> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createBrowserSupabase();
  const supabase = supabaseRef.current;

  // Reconciliar la selección con la lista refrescada.
  useEffect(() => {
    setSelected((cur) =>
      cur ? initialConversations.find((c) => c.id === cur.id) ?? cur : initialConversations[0] ?? null
    );
  }, [initialConversations]);

  // Realtime de la lista: cualquier cambio en conversaciones refresca el server component.
  useEffect(() => {
    const channel = supabase
      .channel("convs-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        router.refresh();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, router]);

  // Mensajes de la conversación seleccionada + realtime de nuevos mensajes.
  useEffect(() => {
    if (!selected) {
      setMessages([]);
      return;
    }
    let active = true;
    supabase
      .from("messages")
      .select("id, sender, content, msg_type, media_path, media_url, created_at")
      .eq("conversation_id", selected.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (active) setMessages((data as Message[]) ?? []);
      });

    const channel = supabase
      .channel(`conv-msgs-${selected.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selected.id}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [selected, supabase]);

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      {/* Lista de conversaciones */}
      <div className="space-y-2">
        {initialConversations.length === 0 && (
          <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400">
            Aún no hay conversaciones.
          </p>
        )}
        {initialConversations.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelected(c)}
            className={`block w-full rounded-xl border p-3 text-left ${
              selected?.id === c.id
                ? "border-neutral-900 bg-white"
                : "border-neutral-200 bg-white hover:border-neutral-400"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-neutral-900">{c.customer_phone}</p>
              <StatusBadge status={c.status} />
            </div>
            <p className="mt-1 text-[11px] text-neutral-400">
              {c.last_customer_message_at
                ? new Date(c.last_customer_message_at).toLocaleString("es-CO")
                : new Date(c.created_at).toLocaleString("es-CO")}
            </p>
          </button>
        ))}
      </div>

      {/* Detalle (solo lectura) */}
      {selected ? (
        <div className="flex min-h-[480px] flex-col rounded-2xl border border-neutral-200 bg-white">
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
            <p className="text-sm font-medium text-neutral-900">{selected.customer_phone}</p>
            <div className="flex items-center gap-2">
              <StatusBadge status={selected.status} />
              {selected.status !== "closed" && (
                <form
                  action={closeConversation}
                  onSubmit={(e) => {
                    if (
                      !confirm(
                        "¿Cerrar esta conversación? Si el cliente vuelve a escribir, el asesor arranca de cero (sin el contexto anterior). El historial no se borra."
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="conversation_id" value={selected.id} />
                  <button
                    type="submit"
                    className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
                  >
                    Cerrar conversación
                  </button>
                </form>
              )}
            </div>
          </div>
          <div className="flex-1 space-y-2 overflow-auto p-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                  m.sender === "customer"
                    ? "bg-neutral-100 text-neutral-800"
                    : "ml-auto bg-neutral-900 text-white"
                }`}
              >
                <MessageBody m={m} />
                <span className="mt-1 block text-[10px] opacity-60">{m.sender}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-[480px] items-center justify-center rounded-2xl border border-neutral-200 bg-white text-sm text-neutral-400">
          Selecciona una conversación
        </div>
      )}
    </div>
  );
}
