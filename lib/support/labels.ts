// Vocabulario del módulo «Solicitudes» (support_requests), compartido entre el
// dashboard del cliente, /admin y los correos. Sin dependencias de servidor:
// se puede importar desde componentes de cliente.

export const REQUEST_CATEGORIES = [
  "ajuste_asesor",
  "reporte_error",
  "sugerencia",
  "otro",
] as const;
export type RequestCategory = (typeof REQUEST_CATEGORIES)[number];

export const REQUEST_STATUSES = [
  "nueva",
  "en_revision",
  "aprobada",
  "en_proceso",
  "resuelta",
  "rechazada",
  "cerrada_por_cliente",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const CATEGORY_LABELS: Record<RequestCategory, string> = {
  ajuste_asesor: "Ajuste del asesor",
  reporte_error: "Reporte de error",
  sugerencia: "Sugerencia",
  otro: "Otro",
};

export const STATUS_LABELS: Record<RequestStatus, string> = {
  nueva: "Nueva",
  en_revision: "En revisión",
  aprobada: "Aprobada",
  en_proceso: "En proceso",
  resuelta: "Resuelta",
  rechazada: "Rechazada",
  cerrada_por_cliente: "Cerrada",
};

// Clases Tailwind del badge de estado (mismo sistema de pills del dashboard).
export const STATUS_BADGE: Record<RequestStatus, string> = {
  nueva: "bg-neutral-100 text-neutral-600",
  en_revision: "bg-amber-100 text-amber-800",
  aprobada: "bg-blue-100 text-blue-700",
  en_proceso: "bg-violet-100 text-violet-700",
  resuelta: "bg-emerald-100 text-emerald-700",
  rechazada: "bg-red-100 text-red-700",
  cerrada_por_cliente: "bg-neutral-100 text-neutral-500",
};

export function formatEta(etaDate: string): string {
  // eta_date es un `date` de Postgres ("2026-07-25"); fijar mediodía UTC evita
  // que el huso horario lo corra un día.
  return new Date(`${etaDate}T12:00:00Z`).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
