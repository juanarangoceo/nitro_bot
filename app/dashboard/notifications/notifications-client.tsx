"use client";

import { useState, useTransition } from "react";
import { dismissNotification } from "./actions";

export type ClientNotification = {
  id: string;
  title: string;
  body: string;
  tone: string;
  created_at: string;
};

const TONE_STYLE: Record<string, string> = {
  info: "border-sky-200 bg-sky-50",
  warning: "border-amber-200 bg-amber-50",
  urgent: "border-red-200 bg-red-50",
};

const TONE_DOT: Record<string, string> = {
  info: "bg-sky-500",
  warning: "bg-amber-500",
  urgent: "bg-red-600",
};

export function NotificationsClient({
  initialNotifications,
}: {
  initialNotifications: ClientNotification[];
}) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const dismiss = (id: string) => {
    setPendingId(id);
    startTransition(async () => {
      const ok = await dismissNotification(id);
      if (ok) setNotifications((current) => current.filter((item) => item.id !== id));
      setPendingId(null);
    });
  };

  if (notifications.length === 0) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white px-6 py-12 text-center">
        <p className="text-sm font-medium text-neutral-700">No tienes notificaciones</p>
        <p className="mt-1 text-xs text-neutral-400">
          Los avisos importantes de Nitro aparecerán aquí.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {notifications.map((notification) => (
        <article
          key={notification.id}
          className={`relative rounded-2xl border p-5 pr-12 ${
            TONE_STYLE[notification.tone] ?? TONE_STYLE.info
          }`}
        >
          <button
            type="button"
            onClick={() => dismiss(notification.id)}
            disabled={pendingId === notification.id}
            aria-label={`Descartar ${notification.title}`}
            title="Ocultar para mí"
            className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none text-neutral-400 hover:bg-white/70 hover:text-neutral-700 disabled:opacity-40"
          >
            ×
          </button>
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                TONE_DOT[notification.tone] ?? TONE_DOT.info
              }`}
            />
            <h2 className="font-semibold text-neutral-900">{notification.title}</h2>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-700">
            {notification.body}
          </p>
          <p className="mt-3 text-[11px] text-neutral-400">
            {new Date(notification.created_at).toLocaleString("es-CO")}
          </p>
        </article>
      ))}
    </div>
  );
}
