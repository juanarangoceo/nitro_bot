// Callback OAuth de Shopify (spec 08). Ruta PÚBLICA (Shopify redirige aquí),
// por eso la validación es estricta y en orden:
//   1. state existe (sin state no se ejecuta nada — previene replays/visitas).
//   2. state no vencido (<10 min).
//   3. HMAC de la query verificado en tiempo constante con el client secret.
//   4. shop coincide EXACTO con el dominio del tenant del state.
//   5. state consumido atómicamente (un solo uso) ANTES del intercambio.
//   6. scopes devueltos verificados antes de guardar.
// El token y el client secret jamás aparecen en logs, errores ni redirects.

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { env } from "@/lib/env";
import { logEvent } from "@/lib/ops/events";
import { enqueue } from "@/lib/queue";
import { registerShopifyWebhooks } from "@/lib/provisioning/webhooks";
import { runBackfill } from "@/lib/provisioning/catalog";
import {
  exchangeCodeForToken,
  isValidShopDomain,
  missingScopes,
  verifyCallbackHmac,
  OAUTH_STATE_TTL_MS,
} from "@/lib/shopify/oauth";

export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams;
  const state = q.get("state") ?? "";
  const shop = q.get("shop") ?? "";
  const code = q.get("code") ?? "";

  const admin = createAdminClient();

  // Fallo sin tenant conocido: no hay detalle al cual volver.
  const failGeneric = async (reason: string): Promise<never> => {
    await logEvent({ kind: "oauth_failure", severity: "error", detail: { reason } });
    redirect(`/admin?shopify_oauth=error&reason=${encodeURIComponent(reason)}`);
  };

  if (!state || !shop || !code) await failGeneric("Callback incompleto (faltan parámetros).");

  // 1) Resolver el state (peek; se consume tras validar el HMAC).
  const { data: stateRow } = await admin
    .from("shopify_oauth_states")
    .select("state, tenant_id, shop_domain, admin_id, created_at")
    .eq("state", state)
    .maybeSingle();
  if (!stateRow) await failGeneric("State desconocido o ya usado.");

  const tenantId = stateRow!.tenant_id;
  const detailUrl = `/admin/clients/${tenantId}`;
  const fail = async (reason: string): Promise<never> => {
    await logEvent({
      kind: "oauth_failure",
      severity: "error",
      tenantId,
      detail: { reason },
    });
    redirect(`${detailUrl}?shopify_oauth=error&reason=${encodeURIComponent(reason)}`);
  };

  // 2) Expiración del state.
  const age = Date.now() - new Date(stateRow!.created_at).getTime();
  if (age > OAUTH_STATE_TTL_MS) {
    await admin.from("shopify_oauth_states").delete().eq("state", state);
    await fail("El enlace de conexión venció (10 min). Inicia de nuevo.");
  }

  // Credenciales de la app del tenant.
  const { data: sec } = await admin
    .from("tenant_secrets")
    .select("shopify_client_id, shopify_client_secret")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!sec?.shopify_client_id || !sec.shopify_client_secret) {
    await fail("El tenant no tiene Client ID/Secret guardados.");
  }
  let clientSecret: string;
  try {
    clientSecret = decryptSecret(sec!.shopify_client_secret!);
  } catch {
    return await fail("El Client Secret guardado no descifra.");
  }

  // 3) HMAC en tiempo constante, antes de cualquier acción con el code.
  if (!verifyCallbackHmac(q, clientSecret)) {
    await fail("Firma HMAC inválida en el callback.");
  }

  // 4) shop EXACTO contra el dominio del tenant del state (formato verificado).
  if (!isValidShopDomain(shop) || shop !== stateRow!.shop_domain) {
    await fail("El parámetro shop no coincide con la tienda del tenant.");
  }

  // 5) Consumir el state de forma atómica (un solo uso): si otra petición lo
  //    consumió primero, esta pierde.
  const { data: consumed } = await admin
    .from("shopify_oauth_states")
    .delete()
    .eq("state", state)
    .select("state");
  if (!consumed || consumed.length === 0) {
    await fail("El enlace ya fue usado.");
  }

  // 6) Intercambio del code por el token offline permanente.
  let accessToken: string;
  let grantedScope: string;
  try {
    const r = await exchangeCodeForToken({
      shopDomain: shop,
      clientId: sec!.shopify_client_id!,
      clientSecret,
      code,
    });
    accessToken = r.accessToken;
    grantedScope = r.scope;
  } catch (e) {
    return await fail(`No se pudo canjear el código: ${(e as Error).message}`);
  }

  // 7) Verificación de scopes: si falta alguno, NO guardar.
  const missing = missingScopes(grantedScope);
  if (missing.length > 0) {
    await fail(
      `A la app le faltan permisos: ${missing.join(", ")}. Ajusta los scopes y reconecta.`
    );
  }

  // 8) Guardar cifrado. El webhook_secret pasa a ser el client secret de la
  //    app: los webhooks registrados por API se firman con él (coherente con
  //    la validación HMAC existente en app/api/webhooks/shopify).
  const { error: saveErr } = await admin.from("tenant_secrets").upsert(
    {
      tenant_id: tenantId,
      shopify_access_token: encryptSecret(accessToken),
      shopify_webhook_secret: encryptSecret(clientSecret),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" }
  );
  if (saveErr) await fail("No se pudo guardar el token.");

  await admin.from("audit_log").insert({
    admin_id: stateRow!.admin_id,
    action: "shopify_oauth_connected",
    tenant_id: tenantId,
    detail: { shop, scopes_ok: true },
  });

  // 9) Post-conexión en segundo plano (no bloquea el redirect): re-registrar
  //    webhooks (pertenecen a la app; al cambiar de app hay que recrearlos) y
  //    backfill del catálogo. El resultado queda en audit_log.
  const { data: tenant } = await admin
    .from("tenants")
    .select("slug")
    .eq("id", tenantId)
    .maybeSingle();
  const slug = tenant?.slug;
  const baseUrl = env.APP_BASE_URL;
  if (slug && baseUrl) {
    enqueue(async () => {
      const detail: Record<string, unknown> = {};
      try {
        const r = await registerShopifyWebhooks(slug, baseUrl);
        detail.webhooks = r.map((x) => `${x.topic}:${x.action}`).join(", ");
      } catch (e) {
        detail.webhooks_error = (e as Error).message;
      }
      try {
        detail.products = await runBackfill(slug);
      } catch (e) {
        detail.backfill_error = (e as Error).message;
      }
      await admin.from("audit_log").insert({
        admin_id: stateRow!.admin_id,
        action: "shopify_oauth_postconnect",
        tenant_id: tenantId,
        detail,
      });
      if (detail.webhooks_error || detail.backfill_error) {
        await logEvent({
          kind: "oauth_failure",
          severity: "warning",
          tenantId,
          detail: { reason: "post-conexión incompleta", ...detail },
        });
      }
    });
  }

  redirect(`${detailUrl}?shopify_oauth=ok`);
}
