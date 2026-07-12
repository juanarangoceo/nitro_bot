"use client";

// Cuerpo de un mensaje del panel (texto / imagen / audio), compartido por
// Conversaciones y Tickets. La media se sirve por el route handler
// /dashboard/media/[id] (firma URLs del bucket privado).

export type MediaMessage = {
  id: string;
  content: string | null;
  msg_type: string;
  media_path: string | null;
  media_url: string | null;
};

// Los audios de WhatsApp son OGG/Opus, que Safari (Mac/iPhone) no reproduce en
// <audio>. Si el navegador no lo soporta, se pide la versión transcodificada a
// WAV (?format=wav). Se detecta una sola vez por sesión.
let oggOpusSupport: boolean | null = null;
function canPlayOggOpus(): boolean {
  if (oggOpusSupport === null) {
    oggOpusSupport =
      typeof window !== "undefined" &&
      new window.Audio().canPlayType('audio/ogg; codecs="opus"') !== "";
  }
  return oggOpusSupport;
}

export function MessageBody({ m }: { m: MediaMessage }) {
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
    const src = canPlayOggOpus()
      ? `/dashboard/media/${m.id}`
      : `/dashboard/media/${m.id}?format=wav`;
    return <audio controls src={src} className="max-w-full" />;
  }
  return <p className="whitespace-pre-wrap">{m.content}</p>;
}
