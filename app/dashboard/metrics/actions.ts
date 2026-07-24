"use server";

import { getDashboardContext } from "@/lib/dashboard/context";
import { revalidatePath } from "next/cache";

export type InvestmentState = { ok: boolean; error: string | null };

async function requireTenantAdmin() {
  const ctx = await getDashboardContext();
  if (ctx.role !== "admin") {
    throw new Error("Solo el administrador puede registrar inversión.");
  }
  return ctx;
}

export async function createInvestment(
  _prev: InvestmentState,
  formData: FormData
): Promise<InvestmentState> {
  try {
    const { tenant, user, supabase } = await requireTenantAdmin();
    const date = String(formData.get("investment_date") ?? "").trim();
    const channel = String(formData.get("channel") ?? "").trim().slice(0, 60);
    const rawAmount = String(formData.get("amount") ?? "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const amount = Number(rawAmount);
    const note = String(formData.get("note") ?? "").trim().slice(0, 160) || null;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, error: "Selecciona una fecha válida." };
    }
    if (!channel) return { ok: false, error: "Escribe el canal de publicidad." };
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "La inversión debe ser mayor que cero." };
    }

    const { error } = await supabase.from("marketing_investments").insert({
      tenant_id: tenant.id,
      investment_date: date,
      channel,
      amount,
      note,
      created_by: user.id,
    });
    if (error) return { ok: false, error: "No se pudo registrar la inversión." };

    revalidatePath("/dashboard/metrics");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteInvestment(formData: FormData): Promise<void> {
  const { supabase } = await requireTenantAdmin();
  const id = String(formData.get("investment_id") ?? "");
  if (!id) return;
  await supabase.from("marketing_investments").delete().eq("id", id);
  revalidatePath("/dashboard/metrics");
}
