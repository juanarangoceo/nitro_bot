// Configuración del módulo de carritos abandonados por tenant.
// Vive en tenants.cart_settings (jsonb); aquí los defaults y el merge seguro.

import type { Tenant } from "../tenant";

export type CartSettings = {
  // [recordatorio 1, recordatorio 2] en minutos desde la ÚLTIMA actividad
  // del checkout (checkouts/update reprograma el reloj).
  delays_minutes: [number, number];
  template_1: string;
  template_2: string;
  template_language: string; // código EXACTO de Meta (verificado por API: es_CO)
  // Base fija de la URL del botón de la plantilla. El webhook trae la URL
  // completa; solo se envía como variable el sufijo restante. Si la URL no
  // empieza por esta base, NO se envía (un botón roto es peor que no enviar).
  checkout_url_base: string;
  // "token": el sufijo del botón es el token del checkout sobre la base cn/
  // (formato clásico — restaura productos pero NO los datos del cliente).
  // "redirect": el sufijo es el id del checkout y la plantilla apunta al
  // redirect propio APP_BASE_URL/r/c/{id}, que 302 a la URL REAL de
  // recuperación de Shopify (ac/…/recover?key=…, checkout PRELLENADO) y de
  // paso mide clicks. Requiere una plantilla cuya base sea el redirect.
  link_mode: "token" | "redirect";
};

// Costo por plantilla de marketing (Colombia) para la telemetría de
// facturación (event_log kind wa_template_usage). Ajustar si Meta cambia tarifa.
export const CART_TEMPLATE_UNIT_COST_USD = 0.0144;

const DEFAULTS: CartSettings = {
  delays_minutes: [60, 1440],
  template_1: "carrito_recordatorio_1",
  template_2: "carrito_recordatorio_2",
  template_language: "es_CO",
  checkout_url_base: "", // vacío = módulo sin configurar: el cron no envía
  link_mode: "token", // el deploy es inerte hasta cambiarlo en /admin
};

export function cartSettings(tenant: Pick<Tenant, "cart_settings">): CartSettings {
  const raw = (tenant.cart_settings ?? {}) as Partial<Record<keyof CartSettings, unknown>>;
  const delays = Array.isArray(raw.delays_minutes) ? raw.delays_minutes : [];
  const d1 = Number(delays[0]);
  const d2 = Number(delays[1]);
  return {
    delays_minutes: [
      Number.isFinite(d1) && d1 > 0 ? d1 : DEFAULTS.delays_minutes[0],
      Number.isFinite(d2) && d2 > 0 ? d2 : DEFAULTS.delays_minutes[1],
    ],
    template_1: typeof raw.template_1 === "string" && raw.template_1 ? raw.template_1 : DEFAULTS.template_1,
    template_2: typeof raw.template_2 === "string" && raw.template_2 ? raw.template_2 : DEFAULTS.template_2,
    template_language:
      typeof raw.template_language === "string" && raw.template_language
        ? raw.template_language
        : DEFAULTS.template_language,
    checkout_url_base:
      typeof raw.checkout_url_base === "string" ? raw.checkout_url_base.trim() : DEFAULTS.checkout_url_base,
    link_mode: raw.link_mode === "redirect" ? "redirect" : DEFAULTS.link_mode,
  };
}

// Etiquetas de estado compartidas por el dashboard y /admin.
export const CART_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending: { label: "Pendiente", className: "bg-neutral-100 text-neutral-600" },
  reminded_1: { label: "1er recordatorio", className: "bg-sky-100 text-sky-700" },
  reminded_2: { label: "2º recordatorio", className: "bg-indigo-100 text-indigo-700" },
  recovered: { label: "Recuperado", className: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Compró antes", className: "bg-emerald-50 text-emerald-600" },
  opted_out: { label: "Pidió no recibir", className: "bg-amber-100 text-amber-700" },
  expired: { label: "Expirado", className: "bg-neutral-100 text-neutral-400" },
};
