// Inicio del flujo OAuth de Shopify para un tenant (spec 08).
// Solo super-admin (se invoca desde el botón "Conectar Shopify" del panel).
// Genera el state anti-CSRF, lo persiste y redirige a la pantalla de
// autorización de Shopify.

import { redirect } from "next/navigation";
import { getPlatformAdminContext } from "@/lib/admin/context";
import { decryptSecret } from "@/lib/crypto";
import { env } from "@/lib/env";
import {
  buildAuthorizeUrl,
  generateOauthState,
  isValidShopDomain,
  OAUTH_STATE_CLEANUP_MS,
} from "@/lib/shopify/oauth";

export async function GET(req: Request): Promise<Response> {
  const { admin, adminId } = await getPlatformAdminContext();

  const tenantId = new URL(req.url).searchParams.get("tenant_id") ?? "";
  if (!tenantId) redirect("/admin");
  const detailUrl = `/admin/clients/${tenantId}`;
  const fail = (reason: string): never =>
    redirect(`${detailUrl}?shopify_oauth=error&reason=${encodeURIComponent(reason)}`);

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, shopify_domain")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) redirect("/admin");
  if (!tenant.shopify_domain || !isValidShopDomain(tenant.shopify_domain)) {
    fail("El tenant no tiene un dominio *.myshopify.com válido.");
  }

  const { data: sec } = await admin
    .from("tenant_secrets")
    .select("shopify_client_id, shopify_client_secret")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!sec?.shopify_client_id || !sec.shopify_client_secret) {
    fail("Guarda primero el Client ID y el Client Secret de la app.");
  }
  // Verifica que el secret descifra (configuración sana) sin usar el valor aquí.
  try {
    decryptSecret(sec!.shopify_client_secret!);
  } catch {
    fail("El Client Secret guardado no descifra; vuelve a guardarlo.");
  }

  const baseUrl = env.APP_BASE_URL;
  if (!baseUrl) return fail("Falta APP_BASE_URL en el entorno.");

  // Limpieza de estados viejos (>1 h) + alta del nuevo (un solo uso, 10 min).
  const state = generateOauthState();
  await admin
    .from("shopify_oauth_states")
    .delete()
    .lt("created_at", new Date(Date.now() - OAUTH_STATE_CLEANUP_MS).toISOString());
  const { error } = await admin.from("shopify_oauth_states").insert({
    state,
    tenant_id: tenantId,
    shop_domain: tenant!.shopify_domain!,
    admin_id: adminId,
  });
  if (error) fail("No se pudo iniciar el flujo (state).");

  redirect(
    buildAuthorizeUrl({
      shopDomain: tenant!.shopify_domain!,
      clientId: sec!.shopify_client_id!,
      redirectUri: `${baseUrl.replace(/\/+$/, "")}/api/shopify/oauth/callback`,
      state,
    })
  );
}
