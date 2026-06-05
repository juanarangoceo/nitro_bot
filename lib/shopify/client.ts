// Cliente GraphQL Admin API de Shopify, por tenant.
// Shopify deprecó REST; usamos GraphQL. La versión se fija aquí.

export const SHOPIFY_API_VERSION = "2026-04";

export type ShopifyCreds = {
  domain: string; // xxx.myshopify.com
  accessToken: string; // shpat_...
};

export async function shopifyGraphQL<T = unknown>(
  creds: ShopifyCreds,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(
    `https://${creds.domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": creds.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(
      `Shopify GraphQL falló: ${JSON.stringify(json.errors ?? res.status).slice(0, 300)}`
    );
  }
  return json.data as T;
}

// Convierte un GID ("gid://shopify/Product/123") al id numérico ("123"),
// que es el formato que llega en los payloads de los webhooks.
export function gidToNumericId(gid: string): string {
  return gid.split("/").pop() ?? gid;
}
