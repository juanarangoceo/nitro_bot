// Registro best-effort de demanda de búsqueda (tabla search_log) para el
// módulo «Búsquedas» del dashboard. Patrón email/tts: JAMÁS lanza — un fallo
// al registrar no puede tumbar el turno del asesor. No usa logEvent: esto no
// es observabilidad de plataforma (event_log), es analítica del tenant.

import { createAdminClient } from "../supabase/admin";

export async function logSearch(params: {
  tenantId: string;
  conversationId?: string | null;
  kind: "search" | "detail";
  query?: string | null;
  productShopifyId?: string | null;
  resultCount: number;
  topSimilarity?: number | null;
}): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from("search_log").insert({
      tenant_id: params.tenantId,
      conversation_id: params.conversationId ?? null,
      kind: params.kind,
      query: params.query?.slice(0, 300) ?? null,
      product_shopify_id: params.productShopifyId ?? null,
      result_count: params.resultCount,
      top_similarity: params.topSimilarity ?? null,
    });
  } catch (e) {
    console.error("[search-log] no se pudo registrar la búsqueda:", e);
  }
}
