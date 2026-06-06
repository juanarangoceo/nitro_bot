// Carga inicial del catálogo de un tenant (Shopify -> products + embeddings).
// Wrapper delgado sobre backfillCatalog() para que CLI y panel lo invoquen por
// slug. Compartido por scripts/backfill-catalog.ts y provisionTenant.

import { getTenantBySlug } from "../tenant";
import { backfillCatalog } from "../shopify/sync";

export async function runBackfill(slug: string): Promise<number> {
  const resolved = await getTenantBySlug(slug);
  if (!resolved) throw new Error(`No hay tenant con slug "${slug}".`);
  if (!resolved.tenant.shopify_domain || !resolved.secrets.shopify_access_token) {
    throw new Error("El tenant no tiene credenciales de Shopify.");
  }
  return await backfillCatalog(resolved.tenant.id, {
    domain: resolved.tenant.shopify_domain,
    accessToken: resolved.secrets.shopify_access_token,
  });
}
