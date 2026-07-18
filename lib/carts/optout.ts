// Opt-out de marketing («Escribe BAJA para no recibir más recordatorios»).
// Detección server-side por palabras clave — NUNCA el modelo — y aplicación:
// marca al comprador, cierra sus checkouts activos y responde un texto FIJO.
// Bloquea SOLO el marketing saliente: el comprador puede seguir escribiendo y
// el asesor le responde normal.

import { createAdminClient } from "../supabase/admin";
import { logEvent } from "../ops/events";

export const OPTOUT_CONFIRMATION =
  "Listo, no te enviaremos más mensajes promocionales. Si necesitas algo, escríbenos con confianza. 🙂";

// Palabras sueltas: solo si el mensaje ES exactamente eso (evita falsos
// positivos tipo "¿cuánto baja el precio?"). Frases: por contención.
const EXACT_WORDS = new Set(["baja", "stop", "salir", "unsubscribe"]);
const PHRASES = [
  "no mas mensajes",
  "no quiero mas mensajes",
  "no me escriban",
  "no me escribas",
  "no me envien mas",
  "no me manden mas",
  "dar de baja",
  "darme de baja",
  "no mas recordatorios",
  "no quiero recordatorios",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // sin tildes
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectOptOut(text: string | null | undefined): boolean {
  if (!text) return false;
  const norm = normalize(text);
  if (!norm) return false;
  if (EXACT_WORDS.has(norm)) return true;
  // Frases: solo en mensajes cortos (un mensaje largo hablando de otra cosa
  // que contenga la frase es rarísimo, pero acotamos igual a 12 palabras).
  if (norm.split(" ").length > 12) return false;
  return PHRASES.some((p) => norm.includes(p));
}

// Aplica el opt-out: customers.marketing_opt_out + checkouts activos →
// opted_out + traza. Best-effort (el llamador responde el texto fijo aparte).
export async function applyOptOut(params: {
  tenantId: string;
  phone: string;
  conversationId?: string | null;
}): Promise<void> {
  const { tenantId, phone, conversationId } = params;
  const supabase = createAdminClient();
  try {
    await supabase
      .from("customers")
      .upsert(
        { tenant_id: tenantId, phone, marketing_opt_out: true },
        { onConflict: "tenant_id,phone", ignoreDuplicates: false }
      );
    await supabase
      .from("abandoned_checkouts")
      .update({ status: "opted_out", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("phone", phone)
      .in("status", ["pending", "reminded_1", "reminded_2"]);
  } catch (e) {
    console.error("[carts] applyOptOut falló:", e);
  }
  await logEvent({
    kind: "cart_optout",
    severity: "info",
    tenantId,
    conversationId: conversationId ?? null,
    detail: { phone },
  });
}
