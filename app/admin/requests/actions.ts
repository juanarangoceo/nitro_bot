"use server";

// Server Actions de la bandeja de Solicitudes de /admin. Regla del panel:
// verificar super-admin en CADA action, operar con service_role, auditar en
// audit_log y revalidar. Los correos al cliente son best-effort (jamás lanzan).

import { requirePlatformAdmin, logAudit } from "@/lib/admin/context";
import {
  notifySupportRequestReply,
  notifySupportRequestStatus,
} from "@/lib/notify/email";
import { REQUEST_STATUSES, type RequestStatus } from "@/lib/support/labels";
import { revalidatePath } from "next/cache";

export type AdminRequestState = { ok: boolean; error: string | null };

// Estados que la plataforma puede asignar (el cierre propio es del cliente).
const ADMIN_STATUSES: readonly RequestStatus[] = REQUEST_STATUSES.filter(
  (s) => s !== "cerrada_por_cliente"
);

// Cambia estado y/o fecha estimada. Rechazar exige motivo. Si el estado cambió,
// avisa al cliente por correo.
export async function updateRequestStatus(
  _prev: AdminRequestState,
  formData: FormData
): Promise<AdminRequestState> {
  const { admin, adminId } = await requirePlatformAdmin();
  const requestId = String(formData.get("request_id") ?? "");
  const status = String(formData.get("status") ?? "") as RequestStatus;
  const etaDate = String(formData.get("eta_date") ?? "").trim() || null;
  const rejectionNote = String(formData.get("rejection_note") ?? "").trim();

  if (!requestId) return { ok: false, error: "Falta la solicitud." };
  if (!ADMIN_STATUSES.includes(status))
    return { ok: false, error: "Estado inválido." };
  if (status === "rechazada" && !rejectionNote)
    return { ok: false, error: "Para rechazar debes escribir el motivo (el cliente lo verá)." };

  const { data: req } = await admin
    .from("support_requests")
    .select("id, tenant_id, subject, status, eta_date")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return { ok: false, error: "Solicitud no encontrada." };

  const statusChanged = req.status !== status;
  const now = new Date().toISOString();
  const { error } = await admin
    .from("support_requests")
    .update({
      status,
      eta_date: etaDate,
      // El motivo solo aplica al rechazo; al salir de 'rechazada' se limpia.
      rejection_note: status === "rechazada" ? rejectionNote : null,
      updated_at: now,
      ...(statusChanged ? { status_changed_at: now } : {}),
    })
    .eq("id", requestId);
  if (error) return { ok: false, error: "No se pudo actualizar la solicitud." };

  await logAudit(admin, {
    adminId,
    action: "support_request_status",
    tenantId: req.tenant_id,
    detail: { requestId, status, eta_date: etaDate },
  });

  if (statusChanged) {
    await notifySupportRequestStatus({
      tenantId: req.tenant_id,
      requestId,
      subject: req.subject,
      status,
      etaDate,
      rejectionNote: status === "rechazada" ? rejectionNote : null,
    });
  }

  revalidatePath("/admin/requests");
  revalidatePath(`/admin/requests/${requestId}`);
  return { ok: true, error: null };
}

// Responde la solicitud (comentario de plataforma) y avisa al cliente.
export async function replyToRequest(
  _prev: AdminRequestState,
  formData: FormData
): Promise<AdminRequestState> {
  const { admin, adminId } = await requirePlatformAdmin();
  const requestId = String(formData.get("request_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!requestId || !body) return { ok: false, error: "Escribe la respuesta." };

  const { data: req } = await admin
    .from("support_requests")
    .select("id, tenant_id, subject")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return { ok: false, error: "Solicitud no encontrada." };

  const { error } = await admin.from("support_request_comments").insert({
    request_id: requestId,
    tenant_id: req.tenant_id,
    author_role: "platform_admin",
    author_id: adminId,
    body,
  });
  if (error) return { ok: false, error: "No se pudo guardar la respuesta." };

  await admin
    .from("support_requests")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", requestId);

  await logAudit(admin, {
    adminId,
    action: "support_request_reply",
    tenantId: req.tenant_id,
    detail: { requestId },
  });

  await notifySupportRequestReply({
    tenantId: req.tenant_id,
    requestId,
    subject: req.subject,
    body,
  });

  revalidatePath("/admin/requests");
  revalidatePath(`/admin/requests/${requestId}`);
  return { ok: true, error: null };
}
