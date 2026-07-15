// Etiquetas de tickets por tenant: capa compartida entre el flujo de IA
// (enum dinámico de escalar_a_humano + resolución server-side), el escalado
// automático del worker y el aprovisionamiento de tenants nuevos.

import { createAdminClient } from "../supabase/admin";

export type TicketLabel = { id: string; name: string };

// Se siembran en el alta del tenant (y la migración 0021 las sembró para los
// existentes). El admin del tenant puede renombrar/crear/desactivar las suyas.
export const DEFAULT_TICKET_LABELS = [
  "Servicio al cliente",
  "Ventas",
  "Garantías",
  "Reclamos",
  "Logística/Guías",
];

// Fallback determinista motivo→etiqueta cuando la IA no pasa `etiqueta` (o
// pasa una inválida) y para los escalados automáticos del worker. Los nombres
// son los de DEFAULT_TICKET_LABELS: si el tenant renombró la etiqueta, el
// match falla y el ticket queda sin etiqueta (visible para todos) — nunca se
// pierde.
export const REASON_TO_LABEL: Record<string, string> = {
  reclamo: "Reclamos",
  pide_humano: "Servicio al cliente",
  cambio_en_orden: "Logística/Guías",
  fuera_de_catalogo: "Ventas",
  otro: "Servicio al cliente",
  fallo_tecnico: "Servicio al cliente",
  video_recibido: "Servicio al cliente",
};

// Etiquetas activas del tenant en orden ESTABLE (created_at, name): el enum
// de la declaración de herramientas depende de este orden, y un prefijo
// estable conserva la caché implícita de Gemini entre turnos.
export async function loadActiveLabels(tenantId: string): Promise<TicketLabel[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("ticket_labels")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as TicketLabel[];
}

// name (elección de la IA, case-insensitive) → REASON_TO_LABEL → null.
export function resolveLabelId(
  labels: TicketLabel[],
  name?: string | null,
  reason?: string
): string | null {
  const findByName = (n: string | undefined | null) => {
    const needle = n?.trim().toLowerCase();
    if (!needle) return null;
    return labels.find((l) => l.name.trim().toLowerCase() === needle)?.id ?? null;
  };
  return findByName(name) ?? findByName(reason ? REASON_TO_LABEL[reason] : null);
}
