"use server";

// Vaciar el CRM del tenant. Borra TODOS los registros de customers (ninguna
// otra tabla depende de ellos: las órdenes viven en orders y no referencian
// customers). RLS limita el borrado al propio tenant.

import { getDashboardContext } from "@/lib/dashboard/context";
import { revalidatePath } from "next/cache";

export async function clearCrm(): Promise<void> {
  const { supabase, tenant } = await getDashboardContext();

  await supabase.from("customers").delete().eq("tenant_id", tenant.id);

  revalidatePath("/dashboard/crm");
}
