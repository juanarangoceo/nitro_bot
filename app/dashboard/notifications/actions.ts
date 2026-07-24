"use server";

import { getDashboardContext } from "@/lib/dashboard/context";
import { revalidatePath } from "next/cache";

export async function dismissNotification(notificationId: string): Promise<boolean> {
  const { tenant, user, supabase } = await getDashboardContext();
  if (!notificationId) return false;

  // La lectura RLS confirma que la notificación pertenece al tenant y sigue
  // visible. El id recibido desde el navegador nunca se confía por sí solo.
  const { data: notification } = await supabase
    .from("client_notifications")
    .select("id")
    .eq("id", notificationId)
    .eq("is_archived", false)
    .maybeSingle();
  if (!notification) return false;

  const { error } = await supabase.from("client_notification_dismissals").upsert(
    {
      notification_id: notificationId,
      user_id: user.id,
      tenant_id: tenant.id,
    },
    { onConflict: "notification_id,user_id", ignoreDuplicates: true }
  );
  if (error) return false;

  revalidatePath("/dashboard/notifications");
  return true;
}
