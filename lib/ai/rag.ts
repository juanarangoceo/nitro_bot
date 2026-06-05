// Búsqueda semántica de productos (RAG): embebe la consulta del cliente y la
// compara con el catálogo del tenant vía match_products (pgvector). Reutilizada
// por la herramienta buscar_productos del asesor.

import { createAdminClient } from "../supabase/admin";
import { embedQuery } from "./embeddings";

export type ProductMatch = {
  id: string;
  shopify_id: string;
  title: string | null;
  description: string | null;
  price: number | null;
  stock: number | null;
  image_url: string | null;
  similarity: number;
};

export async function searchProducts(
  tenantId: string,
  query: string,
  count = 5
): Promise<ProductMatch[]> {
  const embedding = await embedQuery(query);
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("match_products", {
    p_tenant_id: tenantId,
    p_query_embedding: `[${embedding.join(",")}]`, // pgvector acepta texto
    p_match_count: count,
  });
  if (error) throw new Error(`match_products falló: ${error.message}`);
  return (data ?? []) as ProductMatch[];
}
