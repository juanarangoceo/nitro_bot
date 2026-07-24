"use server";

import { requirePlatformAdmin, logAudit } from "@/lib/admin/context";
import { revalidatePath } from "next/cache";

export type NotificationAdminState = { ok: boolean; error: string | null };

const TONES = ["info", "warning", "urgent"] as const;

export async function createClientNotification(
  _prev: NotificationAdminState,
  formData: FormData
): Promise<NotificationAdminState> {
  const { admin, adminId } = await requirePlatformAdmin();
  const target = String(formData.get("tenant_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const tone = String(formData.get("tone") ?? "info") as (typeof TONES)[number];

  if (!target) return { ok: false, error: "Selecciona un cliente o todos." };
  if (!title || !body) return { ok: false, error: "Completa título y mensaje." };
  if (title.length > 100) return { ok: false, error: "Título máximo: 100 caracteres." };
  if (body.length > 1200) return { ok: false, error: "Mensaje máximo: 1200 caracteres." };
  if (!TONES.includes(tone)) return { ok: false, error: "Prioridad inválida." };

  let tenantIds: string[] = [];
  if (target === "all") {
    const { data } = await admin.from("tenants").select("id").eq("is_active", true);
    tenantIds = (data ?? []).map((tenant) => tenant.id);
  } else {
    const { data } = await admin
      .from("tenants")
      .select("id")
      .eq("id", target)
      .maybeSingle();
    if (!data) return { ok: false, error: "Cliente no encontrado." };
    tenantIds = [data.id];
  }
  if (tenantIds.length === 0) return { ok: false, error: "No hay clientes activos." };

  const { error } = await admin.from("client_notifications").insert(
    tenantIds.map((tenantId) => ({
      tenant_id: tenantId,
      title,
      body,
      tone,
      created_by: adminId,
    }))
  );
  if (error) return { ok: false, error: "No se pudo publicar la notificación." };

  await logAudit(admin, {
    adminId,
    action: "client_notification_created",
    tenantId: target === "all" ? null : target,
    detail: { target, tenant_count: tenantIds.length, title, tone },
  });
  revalidatePath("/admin/notifications");
  revalidatePath("/dashboard/notifications");
  return { ok: true, error: null };
}

export async function archiveClientNotification(formData: FormData): Promise<void> {
  const { admin, adminId } = await requirePlatformAdmin();
  const notificationId = String(formData.get("notification_id") ?? "");
  if (!notificationId) return;

  const { data } = await admin
    .from("client_notifications")
    .update({ is_archived: true })
    .eq("id", notificationId)
    .eq("is_archived", false)
    .select("tenant_id, title")
    .maybeSingle();
  if (!data) return;

  await logAudit(admin, {
    adminId,
    action: "client_notification_archived",
    tenantId: data.tenant_id,
    detail: { notification_id: notificationId, title: data.title },
  });
  revalidatePath("/admin/notifications");
  revalidatePath("/dashboard/notifications");
}
