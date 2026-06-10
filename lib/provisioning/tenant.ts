// Alta/actualización (idempotente) de un tenant con credenciales de Shopify
// cifradas. Lógica compartida por el script CLI (scripts/seed-tenant.ts) y por
// el panel de plataforma (provisionTenant). NO duplica el cifrado ni cambia la
// idempotencia: upsert por slug en tenants + upsert por tenant_id en secrets.

import { createAdminClient } from "../supabase/admin";
import { encryptSecret } from "../crypto";

export type UpsertTenantInput = {
  slug: string;
  name: string;
  shopifyDomain: string;
  // Token manual (compatibilidad). Alternativa: par client_id/client_secret de
  // la app del Dev Dashboard y conectar por OAuth desde el detalle del cliente.
  shopifyAccessToken?: string;
  shopifyApiSecret?: string;
  shopifyClientId?: string;
  shopifyClientSecret?: string;
  systemPrompt?: string;
  plan?: string | null;
  monthlyFee?: number | null;
  messageLimit?: number | null;
};

export async function upsertTenant(
  input: UpsertTenantInput
): Promise<{ id: string; name: string; shopify_domain: string | null }> {
  const supabase = createAdminClient();

  // Solo seteamos las columnas provistas (upsert merge-duplicates preserva el
  // resto: p.ej. el wa_access_token o un system_prompt editado desde /admin).
  const tenantRow: Record<string, unknown> = {
    slug: input.slug,
    name: input.name,
    shopify_domain: input.shopifyDomain,
    is_active: true,
  };
  if (input.systemPrompt !== undefined) tenantRow.system_prompt = input.systemPrompt;
  if (input.plan !== undefined) tenantRow.plan = input.plan;
  if (input.monthlyFee !== undefined) tenantRow.monthly_fee = input.monthlyFee;
  if (input.messageLimit != null) tenantRow.message_limit = input.messageLimit;

  const { data: tenant, error: tErr } = await supabase
    .from("tenants")
    .upsert(tenantRow, { onConflict: "slug" })
    .select("id, name, shopify_domain")
    .single();
  if (tErr) throw new Error(`Upsert tenant falló: ${tErr.message}`);

  // Solo las columnas provistas (merge-duplicates preserva el resto).
  const secretsRow: Record<string, unknown> = {
    tenant_id: tenant.id,
    updated_at: new Date().toISOString(),
  };
  if (input.shopifyAccessToken) {
    secretsRow.shopify_access_token = encryptSecret(input.shopifyAccessToken);
  }
  if (input.shopifyApiSecret) {
    secretsRow.shopify_webhook_secret = encryptSecret(input.shopifyApiSecret);
  }
  if (input.shopifyClientId) secretsRow.shopify_client_id = input.shopifyClientId;
  if (input.shopifyClientSecret) {
    secretsRow.shopify_client_secret = encryptSecret(input.shopifyClientSecret);
  }
  const { error: sErr } = await supabase
    .from("tenant_secrets")
    .upsert(secretsRow, { onConflict: "tenant_id" });
  if (sErr) throw new Error(`Upsert secretos falló: ${sErr.message}`);

  return tenant;
}
