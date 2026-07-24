import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type PaymentMethod = {
  label: string;
  value: string;
};

export type PaymentSettings = {
  holder: string;
  methods: PaymentMethod[];
};

// Fallback para despliegues donde el código llegue antes que la migración.
// También conserva el comportamiento anterior si Supabase está temporalmente
// indisponible al leer esta configuración no crítica.
export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  holder: "Juan Arango · C.C. 1.088.018.943",
  methods: [
    { label: "Nequi / Llave", value: "314 668 1896" },
    { label: "Davivienda · Cuenta de ahorros", value: "4884 4795 4865" },
  ],
};

function validMethods(value: unknown): PaymentMethod[] | null {
  if (!Array.isArray(value)) return null;
  const methods = value
    .filter(
      (item): item is PaymentMethod =>
        !!item &&
        typeof item === "object" &&
        typeof (item as PaymentMethod).label === "string" &&
        typeof (item as PaymentMethod).value === "string"
    )
    .map((item) => ({
      label: item.label.trim(),
      value: item.value.trim(),
    }))
    .filter((item) => item.label && item.value);
  return methods.length > 0 ? methods : null;
}

export async function getPaymentSettings(): Promise<PaymentSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_settings")
    .select("payment_holder, payment_methods")
    .eq("key", "billing")
    .maybeSingle();

  if (error || !data) {
    if (error && error.code !== "42P01") {
      console.error("[payment-settings] no se pudo cargar la configuración:", error.message);
    }
    return DEFAULT_PAYMENT_SETTINGS;
  }

  const holder =
    typeof data.payment_holder === "string" && data.payment_holder.trim()
      ? data.payment_holder.trim()
      : DEFAULT_PAYMENT_SETTINGS.holder;
  const methods = validMethods(data.payment_methods) ?? DEFAULT_PAYMENT_SETTINGS.methods;
  return { holder, methods };
}
