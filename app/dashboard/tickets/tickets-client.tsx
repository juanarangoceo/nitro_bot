"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { MessageBody } from "../message-body";
import {
  prepareAgentMediaUpload,
  replyToTicket,
  resolveTicket,
  sendUploadedMediaFromAgent,
  type ReplyState,
} from "./actions";

export type TicketRow = {
  id: string;
  reason: string | null;
  created_at: string;
  conversation_id: string;
  customer_phone: string;
  status: string;
  label_name: string | null;
  // Nombre del usuario al que se asignó el ticket (null = general).
  assigned_name: string | null;
};

type Message = {
  id: string;
  sender: string;
  sent_by: string | null;
  content: string | null;
  msg_type: string;
  media_path: string | null;
  media_url: string | null;
  created_at: string;
};

const replyInit: ReplyState = { ok: false, error: null };

export function TicketsClient({
  initialTickets,
  team,
}: {
  initialTickets: TicketRow[];
  // id → nombre (o correo) del equipo, para "quién respondió" en cada burbuja.
  team: Record<string, string>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<TicketRow | null>(initialTickets[0] ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyState, replyAction, replying] = useActionState(replyToTicket, replyInit);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const mediaFileRef = useRef<HTMLInputElement>(null);
  const supabaseRef = useRef<ReturnType<typeof createBrowserSupabase> | null>(null);

  if (!supabaseRef.current) supabaseRef.current = createBrowserSupabase();
  const supabase = supabaseRef.current;

  // Reconciliar la selección con la lista refrescada (router.refresh tras
  // resolver): si el ticket seleccionado ya no está abierto, se limpia el panel.
  useEffect(() => {
    setSelected((cur) => (cur ? initialTickets.find((t) => t.id === cur.id) ?? null : null));
  }, [initialTickets]);

  // Realtime de la lista: cualquier cambio en tickets refresca el server component.
  useEffect(() => {
    const channel = supabase
      .channel("tickets-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => {
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
      .select("id, sender, sent_by, content, msg_type, media_path, media_url, created_at")
      .eq("conversation_id", selected.conversation_id)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (active) setMessages((data as Message[]) ?? []);
      });

    const channel = supabase
      .channel(`msgs-${selected.conversation_id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selected.conversation_id}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        }
      )
      // El worker inserta el mensaje de audio/imagen SIN media_path y lo
      // completa con un UPDATE al subirlo a Storage: sin esto, el reproductor
      // no aparece en vivo hasta recargar.
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selected.conversation_id}`,
        },
        (payload) => {
          const updated = payload.new as Message;
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
          );
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [selected, supabase]);

  // Tras responder con éxito, limpia el textarea vía key remount.
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    if (replyState.ok) setFormKey((k) => k + 1);
  }, [replyState.ok]);

  // El archivo NO viaja por la Server Action (Vercel corta el body en 4,5 MB
  // y un video de WhatsApp llega a 16 MB): se pide una URL firmada, se sube
  // DIRECTO a Supabase Storage desde el navegador y una action liviana lo
  // envía por WhatsApp.
  async function handleSendMedia(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = mediaFileRef.current?.files?.[0];
    const conversationId = selected?.conversation_id;
    if (!conversationId) return;
    if (!file || file.size === 0) {
      setMediaError("Selecciona un archivo.");
      return;
    }
    setSendingMedia(true);
    setMediaError(null);
    try {
      const mime = file.type || "application/octet-stream";
      const prep = await prepareAgentMediaUpload(conversationId, mime, file.size);
      if (!prep.ok) throw new Error(prep.error);
      const { error: upErr } = await supabase.storage
        .from("wa-media")
        .uploadToSignedUrl(prep.path, prep.token, file, { contentType: mime });
      if (upErr) throw new Error("No se pudo subir el archivo. Inténtalo de nuevo.");
      const sent = await sendUploadedMediaFromAgent(conversationId, prep.path, mime);
      if (sent.error) throw new Error(sent.error);
      if (mediaFileRef.current) mediaFileRef.current.value = "";
    } catch (err) {
      setMediaError((err as Error).message);
    } finally {
      setSendingMedia(false);
    }
  }

  // Auto-scroll al fondo del panel de mensajes (al cargar y con cada mensaje).
  const messagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      {/* Lista de tickets */}
      <div className="max-h-[calc(100dvh-11rem)] space-y-2 overflow-y-auto pr-1">
        {initialTickets.length === 0 && (
          <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400">
            No hay tickets abiertos 🎉
          </p>
        )}
        {initialTickets.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelected(t)}
            className={`block w-full rounded-xl border p-3 text-left ${
              selected?.id === t.id
                ? "border-neutral-900 bg-white"
                : "border-neutral-200 bg-white hover:border-neutral-400"
            }`}
          >
            <p className="text-sm font-medium text-neutral-900">{t.customer_phone}</p>
            <p className="text-xs text-neutral-500">{t.reason ?? "escalado"}</p>
            <span
              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                t.label_name
                  ? "bg-neutral-100 text-neutral-600"
                  : "bg-neutral-50 text-neutral-400"
              }`}
            >
              {t.label_name ?? "Sin etiqueta"}
            </span>
            {t.assigned_name && (
              <span className="ml-1 mt-1 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                {t.assigned_name}
              </span>
            )}
            <p className="mt-1 text-[11px] text-neutral-400">
              {new Date(t.created_at).toLocaleString("es-CO")}
            </p>
          </button>
        ))}
      </div>

      {/* Detalle */}
      {selected ? (
        <div className="flex h-[calc(100dvh-11rem)] min-h-[480px] flex-col rounded-2xl border border-neutral-200 bg-white">
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-neutral-900">{selected.customer_phone}</p>
              <p className="text-xs text-neutral-500">
                Estado: {selected.status} · {selected.label_name ?? "Sin etiqueta"}
                {selected.assigned_name ? ` · Asignado a ${selected.assigned_name}` : ""}
              </p>
            </div>
            <form action={resolveTicket}>
              <input type="hidden" name="ticket_id" value={selected.id} />
              <input type="hidden" name="conversation_id" value={selected.conversation_id} />
              <button
                type="submit"
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
              >
                Resolver y devolver al bot
              </button>
            </form>
          </div>

          <div ref={messagesRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
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
                <span className="mt-1 block text-[10px] opacity-60">
                  {(m.sender === "agent" && m.sent_by && team[m.sent_by]) || m.sender} ·{" "}
                  {new Date(m.created_at).toLocaleTimeString("es-CO", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>

          <form key={formKey} action={replyAction} className="border-t border-neutral-100 p-3">
            <input type="hidden" name="conversation_id" value={selected.conversation_id} />
            <div className="flex gap-2">
              <input
                name="text"
                placeholder="Escribe tu respuesta…"
                className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
              />
              <button
                type="submit"
                disabled={replying}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
              >
                {replying ? "Enviando…" : "Enviar"}
              </button>
            </div>
            {replyState.error && <p className="mt-2 text-sm text-red-600">{replyState.error}</p>}
          </form>

          {/* Enviar foto, audio o video (WhatsApp solo acepta video MP4) */}
          <form
            onSubmit={handleSendMedia}
            className="flex items-center gap-2 border-t border-neutral-100 p-3"
          >
            <input
              ref={mediaFileRef}
              type="file"
              name="file"
              accept="image/*,audio/*,video/mp4,video/3gpp"
              className="flex-1 text-xs text-neutral-600 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-xs file:text-neutral-700"
            />
            <button
              type="submit"
              disabled={sendingMedia}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
            >
              {sendingMedia ? "Enviando…" : "Enviar foto/audio/video"}
            </button>
            {mediaError && <p className="text-xs text-red-600">{mediaError}</p>}
          </form>
        </div>
      ) : (
        <div className="flex min-h-[480px] items-center justify-center rounded-2xl border border-neutral-200 bg-white text-sm text-neutral-400">
          Selecciona un ticket
        </div>
      )}
    </div>
  );
}
