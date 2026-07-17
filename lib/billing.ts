// Plan y facturación: constantes de la plataforma (Nitro Ecom) compartidas por
// el módulo /dashboard/plan y el banner de alerta. Los VALORES (mensualidad,
// paquete adicional, fecha de corte, estado) viven en `tenants` y los edita el
// super-admin desde /admin; aquí solo va lo que es igual para todos.

// Tamaño del paquete adicional de mensajes (el precio es por tenant:
// tenants.addon_price).
export const ADDON_MESSAGES = 2000;

// Vigencia del adicional MIENTRAS SU FACTURA SIGA PENDIENTE: pasados estos
// días sin registrar el pago, el bot se pausa aunque queden mensajes (el
// adicional es un puente de cobro, no un mini-plan). Con la factura pagada
// no hay vencimiento: manda solo el tope de mensajes.
export const ADDON_PENDING_DAYS = 15;

// Datos de pago de la plataforma (a donde el cliente consigna la mensualidad).
export const PAYMENT_HOLDER = "Juan Arango · C.C. 1.088.018.943";
export const PAYMENT_METHODS = [
  { label: "Nequi / Llave", value: "314 668 1896" },
  { label: "Davivienda · Cuenta de ahorros", value: "4884 4795 4865" },
] as const;

export function formatCop(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${Number(n).toLocaleString("es-CO")} COP`;
}

// Estado derivado de la facturación del tenant, para el banner y la página del
// plan. La factura está "vencida" si sigue pendiente después de la fecha de
// corte (comparación por día, zona horaria de Colombia).
export type BillingInfo = {
  status: "pagado" | "pendiente";
  dueDate: string | null; // YYYY-MM-DD
  overdue: boolean;
};

export function billingInfo(tenant: {
  billing_status: string | null;
  billing_due_date: string | null;
}): BillingInfo {
  const status = tenant.billing_status === "pendiente" ? "pendiente" : "pagado";
  const dueDate = tenant.billing_due_date;
  let overdue = false;
  if (status === "pendiente" && dueDate) {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
    overdue = dueDate < today;
  }
  return { status, dueDate, overdue };
}

// Fecha de corte legible ("15 de agosto de 2026"). El T12:00Z evita el
// corrimiento de día al formatear una fecha sin hora.
export function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return "—";
  return new Date(`${dueDate}T12:00:00Z`).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
