"use client";

// Badge del sidebar con el número de tickets abiertos "sin leer" (el cliente
// final escribió y nadie lo ha abierto). Vive en el sidebar — visible desde
// CUALQUIER ruta del dashboard — con su propia suscripción Realtime: el canal
// de la página de Tickets solo existe dentro de esa página. RLS hace el
// trabajo de alcance: el count y los eventos llegan ya filtrados por rol
// (admin ve todo; un agente, solo su bandeja).

import { useEffect, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

export function TicketsUnreadBadge() {
  const [count, setCount] = useState(0);
  const supabaseRef = useRef<ReturnType<typeof createBrowserSupabase> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createBrowserSupabase();
  const supabase = supabaseRef.current;

  useEffect(() => {
    let active = true;
    const fetchCount = async () => {
      const { count: n } = await supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .eq("has_unread", true);
      if (active) setCount(n ?? 0);
    };
    void fetchCount();

    const channel = supabase
      .channel("tickets-unread-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => {
        void fetchCount();
      })
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  if (count === 0) return null;
  return (
    <span className="ml-auto rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-semibold text-neutral-900">
      {count}
    </span>
  );
}
