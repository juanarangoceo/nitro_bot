"use server";

// Acciones del módulo «Solicitudes» del cliente. La autorización se apoya en
// RLS + grants por columna (migración 0018): el cliente solo puede crear,
// comentar como 'client' y cerrar sus propias solicitudes. status/eta_date/
// rejection_note solo los cambia la plataforma desde /admin (service_role).

import { getDashboardContext } from "@/lib/dashboard/context";
import { logEvent } from "@/lib/ops/events";
import { REQUEST_CATEGORIES, type RequestCategory } from "@/lib/support/labels";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type RequestFormState = { ok: boolean; error: string | null };

const MAX_SUBJECT = 120;

// Crea una solicitud (estado 'nueva') y redirige a su detalle.
export async function createRequest(
  _prev: RequestFormState,
  formData: FormData
): Promise<RequestFormState> {
  const { tenant, user, supabase } = await getDashboardContext();
  const category = String(formData.get("category") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!REQUEST_CATEGORIES.includes(category as RequestCategory))
    return { ok: false, error: "Selecciona una categoría." };
  if (!subject || !description)
    return { ok: false, error: "Completa el asunto y la descripción." };
  if (subject.length > MAX_SUBJECT)
    return { ok: false, error: `El asunto no puede superar ${MAX_SUBJECT} caracteres.` };

  const { data, error } = await supabase
    .from("support_requests")
    .insert({
      tenant_id: tenant.id,
      created_by: user.id,
      category,
      subject,
      description,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "No se pudo crear la solicitud." };

  await logEvent({
    kind: "support_request",
    severity: "info",
    tenantId: tenant.id,
    detail: { category, subject },
  });

  revalidatePath("/dashboard/requests");
  redirect(`/dashboard/requests/${data.id}`);
}

// Agrega un comentario del cliente al hilo de su solicitud.
export async function addComment(
  _prev: RequestFormState,
  formData: FormData
): Promise<RequestFormState> {
  const { tenant, user, supabase } = await getDashboardContext();
  const requestId = String(formData.get("request_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!requestId || !body) return { ok: false, error: "Escribe un comentario." };

  // La solicitud debe ser del tenant (RLS: si no lo es, no aparece).
  const { data: req } = await supabase
    .from("support_requests")
    .select("id")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return { ok: false, error: "Solicitud no encontrada." };

  const { error } = await supabase.from("support_request_comments").insert({
    request_id: requestId,
    tenant_id: tenant.id,
    author_role: "client",
    author_id: user.id,
    body,
  });
  if (error) return { ok: false, error: "No se pudo guardar el comentario." };

  revalidatePath(`/dashboard/requests/${requestId}`);
  return { ok: true, error: null };
}

// Cierra la propia solicitud («Ya no la necesito»). El grant por columna solo
// permite tocar status, y la policy solo acepta 'cerrada_por_cliente'.
// Sin correo: el cambio lo hizo el propio cliente.
export async function closeRequest(formData: FormData): Promise<void> {
  const { supabase } = await getDashboardContext();
  const requestId = String(formData.get("request_id") ?? "");
  if (!requestId) return;

  await supabase
    .from("support_requests")
    .update({ status: "cerrada_por_cliente" })
    .eq("id", requestId);

  revalidatePath("/dashboard/requests");
  revalidatePath(`/dashboard/requests/${requestId}`);
}
