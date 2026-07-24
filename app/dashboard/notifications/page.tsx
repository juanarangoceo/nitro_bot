import { getDashboardContext } from "@/lib/dashboard/context";
import {
  NotificationsClient,
  type ClientNotification,
} from "./notifications-client";

export default async function NotificationsPage() {
  const { user, supabase } = await getDashboardContext();
  const [{ data: notifications }, { data: dismissals }] = await Promise.all([
    supabase
      .from("client_notifications")
      .select("id, title, body, tone, created_at")
      .eq("is_archived", false)
      .order("created_at", { ascending: false }),
    supabase
      .from("client_notification_dismissals")
      .select("notification_id")
      .eq("user_id", user.id),
  ]);
  const dismissed = new Set((dismissals ?? []).map((row) => row.notification_id));
  const visible = (notifications ?? []).filter((item) => !dismissed.has(item.id));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Notificaciones</h1>
        <p className="text-sm text-neutral-500">
          Avisos y novedades de Nitro para tu equipo. La X los oculta únicamente para ti.
        </p>
      </header>
      <NotificationsClient initialNotifications={visible as ClientNotification[]} />
    </div>
  );
}
