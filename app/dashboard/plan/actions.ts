"use server";

import { getDashboardContext } from "@/lib/dashboard/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadPaymentProof } from "@/lib/storage";
import {
  escTelegram,
  sendTelegramPhoto,
} from "@/lib/notify/telegram";
import { logEvent } from "@/lib/ops/events";
import { formatCop, formatDueDate } from "@/lib/billing";
import { revalidatePath } from "next/cache";

export type PaymentProofState = { ok: boolean; error: string | null };

const MAX_PROOF_BYTES = 3 * 1024 * 1024;
const ALLOWED_PROOF_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function submitPaymentProof(
  _prev: PaymentProofState,
  formData: FormData
): Promise<PaymentProofState> {
  const { tenant, user, role, supabase } = await getDashboardContext();
  if (role !== "admin") {
    return { ok: false, error: "Solo el administrador puede enviar comprobantes." };
  }

  const invoiceId = String(formData.get("invoice_id") ?? "");
  const file = formData.get("proof");
  if (!invoiceId) return { ok: false, error: "Factura no encontrada." };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Selecciona una imagen del comprobante." };
  }
  if (!ALLOWED_PROOF_MIMES.has(file.type)) {
    return { ok: false, error: "Usa una imagen JPG, PNG o WebP." };
  }
  if (file.size > MAX_PROOF_BYTES) {
    return { ok: false, error: "La imagen no puede superar 3 MB." };
  }

  // Lectura con RLS: impide usar un invoice_id de otro tenant.
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, concept, description, amount, status, due_date")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { ok: false, error: "Factura no encontrada." };
  if (invoice.status !== "pendiente") {
    return { ok: false, error: "Esta factura ya figura como pagada." };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const path = await uploadPaymentProof({
      tenantId: tenant.id,
      invoiceId,
      bytes,
      mimeType: file.type,
    });
    const admin = createAdminClient();
    const { error } = await admin
      .from("invoices")
      .update({
        payment_proof_path: path,
        payment_proof_mime: file.type,
        payment_proof_uploaded_at: new Date().toISOString(),
        payment_proof_submitted_by: user.id,
      })
      .eq("id", invoiceId)
      .eq("tenant_id", tenant.id)
      .eq("status", "pendiente");
    if (error) throw error;

    const concept =
      invoice.concept === "renovacion"
        ? "Renovación del plan"
        : invoice.concept === "adicional"
          ? "Paquete adicional"
          : invoice.description?.trim() || "Factura manual";
    await sendTelegramPhoto({
      bytes,
      mimeType: file.type,
      filename: `comprobante-${invoiceId.slice(0, 8)}.${file.type.split("/")[1]}`,
      caption:
        `🧾 <b>Nuevo comprobante de pago</b>\n` +
        `Cliente: <b>${escTelegram(tenant.name)}</b>\n` +
        `Factura: ${escTelegram(concept)}\n` +
        `Valor: <b>${escTelegram(formatCop(Number(invoice.amount)))}</b>\n` +
        (invoice.due_date
          ? `Vencimiento: ${escTelegram(formatDueDate(invoice.due_date))}\n`
          : "") +
        `ID: <code>${escTelegram(invoiceId.slice(0, 8))}</code>`,
    });
    await logEvent({
      kind: "payment_proof",
      tenantId: tenant.id,
      detail: { invoice_id: invoiceId, concept: invoice.concept, amount: invoice.amount },
    });
    revalidatePath("/dashboard/plan");
    return { ok: true, error: null };
  } catch (e) {
    console.error("[payment-proof] no se pudo guardar:", (e as Error).message);
    return { ok: false, error: "No se pudo enviar el comprobante. Inténtalo de nuevo." };
  }
}
