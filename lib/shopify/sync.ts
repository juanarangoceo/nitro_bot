// Sincronización de catálogo Shopify -> Supabase (products) + embeddings.
// Una sola fuente de verdad usada por el webhook (incremental) y por el
// backfill inicial. Todo se mapea desde GraphQL para evitar divergencia de
// formatos entre REST y GraphQL.

import { createAdminClient } from "../supabase/admin";
import { embedDocument } from "../ai/embeddings";
import { shopifyGraphQL, gidToNumericId, type ShopifyCreds } from "./client";

const PRODUCT_FIELDS = `
  id
  handle
  title
  description
  productType
  tags
  status
  totalInventory
  featuredImage { url }
  media(first: 10) { edges { node { mediaContentType
    ... on MediaImage { image { url } }
    ... on Video { sources { url mimeType height fileSize } }
  } } }
  priceRangeV2 { minVariantPrice { amount } }
  variants(first: 1) { edges { node { id compareAtPrice } } }
`;

type ProductNode = {
  id: string;
  handle: string | null;
  title: string | null;
  description: string | null;
  productType: string | null;
  tags: string[];
  status: string | null;
  totalInventory: number | null;
  featuredImage: { url: string } | null;
  media: {
    edges: {
      node: {
        mediaContentType: string;
        image?: { url: string } | null;
        sources?: {
          url: string;
          mimeType: string | null;
          height: number | null;
          fileSize: number | null;
        }[];
      };
    }[];
  };
  priceRangeV2: { minVariantPrice: { amount: string } } | null;
  variants: { edges: { node: { id: string; compareAtPrice: string | null } }[] };
};

// Galería ordenada de URLs: la principal (featuredImage) de primera, luego el
// resto de imágenes de media, sin duplicados.
function buildImageUrls(n: ProductNode): string[] {
  const gallery = (n.media?.edges ?? [])
    .filter((e) => e.node.mediaContentType === "IMAGE" && e.node.image?.url)
    .map((e) => e.node.image!.url);
  const all = n.featuredImage?.url ? [n.featuredImage.url, ...gallery] : gallery;
  return [...new Set(all)];
}

// Videos de producto enviables por WhatsApp: de cada video de la galería se
// elige la rendition MP4 de mayor resolución que quepa en 16 MB (tope de la
// Cloud API). Shopify transcodifica a H.264/AAC, el códec que WhatsApp exige.
const WA_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
function buildVideoUrls(n: ProductNode): string[] {
  const urls: string[] = [];
  for (const e of n.media?.edges ?? []) {
    if (e.node.mediaContentType !== "VIDEO") continue;
    const best = (e.node.sources ?? [])
      .filter(
        (s) =>
          s.url &&
          (s.mimeType ?? "").startsWith("video/mp4") &&
          (s.fileSize ?? Infinity) <= WA_VIDEO_MAX_BYTES
      )
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
    if (best) urls.push(best.url);
  }
  return [...new Set(urls)];
}

// Texto que se convierte en embedding: lo que un cliente preguntaría.
function buildEmbeddingText(n: ProductNode): string {
  return [n.title, n.productType, (n.tags ?? []).join(" "), n.description]
    .filter(Boolean)
    .join(". ")
    .slice(0, 4000);
}

async function upsertProductNode(tenantId: string, n: ProductNode): Promise<void> {
  const supabase = createAdminClient();
  const embedding = await embedDocument(buildEmbeddingText(n));
  const { error } = await supabase.from("products").upsert(
    {
      tenant_id: tenantId,
      shopify_id: gidToNumericId(n.id),
      shopify_variant_id: n.variants.edges[0]?.node.id ?? null,
      handle: n.handle,
      title: n.title,
      description: n.description,
      price: n.priceRangeV2 ? Number(n.priceRangeV2.minVariantPrice.amount) : null,
      compare_at_price: n.variants.edges[0]?.node.compareAtPrice
        ? Number(n.variants.edges[0].node.compareAtPrice)
        : null,
      stock: n.totalInventory,
      image_url: n.featuredImage?.url ?? null,
      image_urls: buildImageUrls(n),
      video_urls: buildVideoUrls(n),
      status: (n.status ?? "active").toLowerCase(),
      embedding: embedding as unknown as string, // pgvector acepta el array
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,shopify_id" }
  );
  if (error) throw new Error(`Upsert de producto falló: ${error.message}`);
}

// Sincroniza un producto puntual por id numérico (usado por el webhook).
export async function syncProductById(
  tenantId: string,
  creds: ShopifyCreds,
  numericId: string
): Promise<void> {
  const gid = `gid://shopify/Product/${numericId}`;
  const data = await shopifyGraphQL<{ product: ProductNode | null }>(
    creds,
    `query($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }`,
    { id: gid }
  );
  if (!data.product) {
    // El producto ya no existe en Shopify -> eliminar localmente.
    await deleteProductById(tenantId, numericId);
    return;
  }
  await upsertProductNode(tenantId, data.product);
}

export async function deleteProductById(
  tenantId: string,
  numericId: string
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("products")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("shopify_id", numericId);
  if (error) throw new Error(`Borrado de producto falló: ${error.message}`);
}

// Carga inicial completa del catálogo (paginada). Devuelve cuántos sincronizó.
export async function backfillCatalog(
  tenantId: string,
  creds: ShopifyCreds
): Promise<number> {
  let cursor: string | null = null;
  let count = 0;
  for (;;) {
    const data: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: { node: ProductNode }[];
      };
    } = await shopifyGraphQL(
      creds,
      `query($cursor: String) {
        products(first: 25, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          edges { node { ${PRODUCT_FIELDS} } }
        }
      }`,
      { cursor }
    );
    for (const edge of data.products.edges) {
      await upsertProductNode(tenantId, edge.node);
      count++;
    }
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }
  return count;
}
