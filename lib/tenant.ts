// Resolución de tenant y carga de credenciales por tienda.
// Las credenciales viven cifradas en tenant_secrets y solo se descifran aquí,
// del lado del servidor. Usa el cliente service_role (ignora RLS).

import { createAdminClient } from "./supabase/admin";
import { decryptSecret } from "./crypto";

export type Tenant = {
  id: string;
  name: string;
  slug: string | null;
  shopify_domain: string | null;
  wa_phone_number_id: string | null;
  wa_business_account_id: string | null;
  system_prompt: string | null;
  business_info: string | null;
  ai_model: string;
  embedding_model: string;
  embedding_dim: number;
  shipping_rules: Record<string, unknown>;
  payment_mode: string;
  message_limit: number;
  current_month_messages: number;
  modules: Record<string, boolean>;
  is_active: boolean;
};

export type TenantSecrets = {
  shopify_access_token: string | null;
  shopify_webhook_secret: string | null;
  wa_access_token: string | null;
};

function decryptMaybe(v: string | null): string | null {
  return v ? decryptSecret(v) : null;
}

async function loadSecrets(tenantId: string): Promise<TenantSecrets> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("tenant_secrets")
    .select("shopify_access_token, shopify_webhook_secret, wa_access_token")
    .eq("tenant_id", tenantId)
    .single();
  if (error) throw new Error(`No se cargaron secretos del tenant: ${error.message}`);
  return {
    shopify_access_token: decryptMaybe(data.shopify_access_token),
    shopify_webhook_secret: decryptMaybe(data.shopify_webhook_secret),
    wa_access_token: decryptMaybe(data.wa_access_token),
  };
}

async function resolveBy(
  column: "shopify_domain" | "wa_phone_number_id" | "slug",
  value: string
): Promise<{ tenant: Tenant; secrets: TenantSecrets } | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("*")
    .eq(column, value)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`Error resolviendo tenant: ${error.message}`);
  if (!data) return null;
  const secrets = await loadSecrets(data.id);
  return { tenant: data as Tenant, secrets };
}

export function getTenantByShopDomain(domain: string) {
  return resolveBy("shopify_domain", domain);
}

export function getTenantByPhoneNumberId(phoneNumberId: string) {
  return resolveBy("wa_phone_number_id", phoneNumberId);
}

export function getTenantBySlug(slug: string) {
  return resolveBy("slug", slug);
}
