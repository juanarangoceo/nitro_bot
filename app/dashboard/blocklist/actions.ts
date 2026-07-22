"use server";

// Acciones del módulo «Bloqueados» (solo admin del tenant). La autorización
// real vive en RLS (migración 0036: solo el rol admin inserta/elimina);
// aquí se re-verifica el rol para fallar con un mensaje claro.

import { getDashboardContext } from "@/lib/dashboard/context";
import { normalizeCoPhone } from "@/lib/shopify/orders";
import { revalidatePath } from "next/cache";

export type BlockFormState = { ok: boolean; error: string | null };

const MAX_NOTE = 200;

async function requireTenantAdmin() {
  const ctx = await getDashboardContext();
  if (ctx.role !== "admin")
    throw new Error("Solo el administrador puede gestionar los números bloqueados.");
  return ctx;
}

export async function blockNumber(
  _prev: BlockFormState,
  formData: FormData
): Promise<BlockFormState> {
  try {
    const { tenant, supabase, user } = await requireTenantAdmin();
    const rawPhone = String(formData.get("phone") ?? "").trim();
    const note = String(formData.get("note") ?? "").trim().slice(0, MAX_NOTE) || null;
    if (!rawPhone) return { ok: false, error: "Escribe el número a bloquear." };

    // Misma normalización que usa el worker para el teléfono del canal: si no
    // calzan, el bloqueo no aplica.
    const phone = normalizeCoPhone(rawPhone);
    if (phone.replace(/\D/g, "").length < 10)
      return { ok: false, error: "El número no parece válido (mínimo 10 dígitos)." };

    const { error } = await supabase
      .from("blocked_numbers")
      .insert({ tenant_id: tenant.id, phone, note, created_by: user.id });
    if (error) {
      return {
        ok: false,
        error:
          error.code === "23505"
            ? "Ese número ya está bloqueado."
            : "No se pudo bloquear el número.",
      };
    }
    revalidatePath("/dashboard/blocklist");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function unblockNumber(formData: FormData): Promise<void> {
  const { supabase } = await requireTenantAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await supabase.from("blocked_numbers").delete().eq("id", id);
  revalidatePath("/dashboard/blocklist");
}
