"use server";

// Acciones del módulo «Etiquetas» del dashboard (solo admin del tenant).
// La autorización real vive en RLS (migración 0021: solo el rol admin escribe
// ticket_labels/app_user_labels); aquí se re-verifica el rol para fallar con
// un mensaje claro antes de tocar la DB.

import { getDashboardContext } from "@/lib/dashboard/context";
import { revalidatePath } from "next/cache";

export type LabelFormState = { ok: boolean; error: string | null };

const MAX_NAME = 60;

async function requireTenantAdmin() {
  const ctx = await getDashboardContext();
  if (ctx.role !== "admin") throw new Error("Solo el administrador puede gestionar etiquetas.");
  return ctx;
}

export async function createLabel(
  _prev: LabelFormState,
  formData: FormData
): Promise<LabelFormState> {
  try {
    const { tenant, supabase } = await requireTenantAdmin();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { ok: false, error: "Escribe el nombre de la etiqueta." };
    if (name.length > MAX_NAME)
      return { ok: false, error: `El nombre no puede superar ${MAX_NAME} caracteres.` };

    const { error } = await supabase
      .from("ticket_labels")
      .insert({ tenant_id: tenant.id, name });
    if (error) {
      return {
        ok: false,
        error: error.code === "23505" ? "Ya existe una etiqueta con ese nombre." : "No se pudo crear la etiqueta.",
      };
    }
    revalidatePath("/dashboard/labels");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function renameLabel(
  _prev: LabelFormState,
  formData: FormData
): Promise<LabelFormState> {
  try {
    const { supabase } = await requireTenantAdmin();
    const labelId = String(formData.get("label_id") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    if (!labelId || !name) return { ok: false, error: "Escribe el nuevo nombre." };
    if (name.length > MAX_NAME)
      return { ok: false, error: `El nombre no puede superar ${MAX_NAME} caracteres.` };

    const { error } = await supabase
      .from("ticket_labels")
      .update({ name })
      .eq("id", labelId);
    if (error) {
      return {
        ok: false,
        error: error.code === "23505" ? "Ya existe una etiqueta con ese nombre." : "No se pudo renombrar.",
      };
    }
    revalidatePath("/dashboard/labels");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Activar/desactivar: una etiqueta inactiva deja de ofrecerse al bot y de
// aparecer en la matriz de asignación, pero los tickets existentes la
// conservan y los filtros de los agentes siguen funcionando.
export async function setLabelActive(formData: FormData): Promise<void> {
  const { supabase } = await requireTenantAdmin();
  const labelId = String(formData.get("label_id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!labelId) return;

  await supabase.from("ticket_labels").update({ is_active: active }).eq("id", labelId);
  revalidatePath("/dashboard/labels");
}

// Eliminar es seguro: los tickets quedan sin etiqueta (visibles para todos) y
// las asignaciones caen en cascada. Para pausar sin perder el historial de
// clasificación, mejor desactivar.
export async function deleteLabel(formData: FormData): Promise<void> {
  const { supabase } = await requireTenantAdmin();
  const labelId = String(formData.get("label_id") ?? "");
  if (!labelId) return;

  await supabase.from("ticket_labels").delete().eq("id", labelId);
  revalidatePath("/dashboard/labels");
}

// Reemplaza las etiquetas de un usuario por la selección de la matriz
// (diff: borra las que sobran, inserta las nuevas).
export async function setUserLabels(
  _prev: LabelFormState,
  formData: FormData
): Promise<LabelFormState> {
  try {
    const { tenant, supabase } = await requireTenantAdmin();
    const userId = String(formData.get("user_id") ?? "");
    if (!userId) return { ok: false, error: "Falta el usuario." };
    const selected = new Set(formData.getAll("label_ids").map(String));

    const { data: current } = await supabase
      .from("app_user_labels")
      .select("label_id")
      .eq("user_id", userId);
    const existing = new Set((current ?? []).map((r) => r.label_id as string));

    const toDelete = [...existing].filter((id) => !selected.has(id));
    const toInsert = [...selected].filter((id) => !existing.has(id));

    if (toDelete.length > 0) {
      const { error } = await supabase
        .from("app_user_labels")
        .delete()
        .eq("user_id", userId)
        .in("label_id", toDelete);
      if (error) return { ok: false, error: "No se pudo actualizar la asignación." };
    }
    if (toInsert.length > 0) {
      const { error } = await supabase.from("app_user_labels").insert(
        toInsert.map((labelId) => ({
          tenant_id: tenant.id,
          user_id: userId,
          label_id: labelId,
        }))
      );
      if (error) return { ok: false, error: "No se pudo actualizar la asignación." };
    }

    revalidatePath("/dashboard/labels");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
