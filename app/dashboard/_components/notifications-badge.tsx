"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

export function NotificationsBadge() {
  const [count, setCount] = useState(0);
  const [supabase] = useState(() => createBrowserSupabase());

  useEffect(() => {
    let active = true;
    const fetchCount = async () => {
      const [{ data: notifications }, { data: dismissals }] = await Promise.all([
        supabase
          .from("client_notifications")
          .select("id")
          .eq("is_archived", false),
        supabase.from("client_notification_dismissals").select("notification_id"),
      ]);
      const dismissed = new Set((dismissals ?? []).map((row) => row.notification_id));
      const next = (notifications ?? []).filter((item) => !dismissed.has(item.id)).length;
      if (active) setCount(next);
    };
    void fetchCount();

    const channel = supabase
      .channel("client-notifications-badge")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "client_notifications" },
        () => void fetchCount()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "client_notification_dismissals" },
        () => void fetchCount()
      )
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [supabase]);

  if (count === 0) return null;
  return (
    <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-semibold text-white">
      {count}
    </span>
  );
}
