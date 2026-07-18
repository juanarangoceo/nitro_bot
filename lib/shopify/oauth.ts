// OAuth de Shopify (authorization code grant, flujo de instalación heredado).
// Una app del Dev Dashboard por cliente; el panel completa la instalación y el
// token offline permanente queda cifrado en tenant_secrets.
//
// Seguridad (spec 08):
//  - state criptográfico de un solo uso con expiración de 10 minutos.
//  - HMAC de la query verificado en tiempo constante ANTES de cualquier acción.
//  - shop validado contra el dominio del tenant (jamás decide el tenant).
//  - scopes devueltos verificados contra los requeridos antes de guardar.

import crypto from "node:crypto";

// Constante única de scopes; reutilizada por la URL de autorización y por la
// verificación post-intercambio.
export const REQUIRED_SCOPES = [
  "read_products",
  "read_orders",
  "write_orders",
  "read_customers",
  "write_customers",
  // Carritos abandonados (Spec 13): webhooks checkouts/create|update.
  "read_checkouts",
] as const;

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos
export const OAUTH_STATE_CLEANUP_MS = 60 * 60 * 1000; // limpiar > 1 h

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function isValidShopDomain(shop: string): boolean {
  return SHOP_DOMAIN_RE.test(shop);
}

export function generateOauthState(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function buildAuthorizeUrl(params: {
  shopDomain: string;
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const q = new URLSearchParams({
    client_id: params.clientId,
    scope: REQUIRED_SCOPES.join(","),
    redirect_uri: params.redirectUri,
    state: params.state,
  });
  return `https://${params.shopDomain}/admin/oauth/authorize?${q.toString()}`;
}

// Shopify firma los parámetros de la query (sin `hmac`) ordenados
// lexicográficamente como key=value&... con HMAC-SHA256 (hex) del client
// secret. Comparación en tiempo constante.
export function verifyCallbackHmac(
  searchParams: URLSearchParams,
  clientSecret: string
): boolean {
  const hmac = searchParams.get("hmac");
  if (!hmac) return false;

  const message = [...searchParams.entries()]
    .filter(([k]) => k !== "hmac")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const digest = crypto
    .createHmac("sha256", clientSecret)
    .update(message, "utf8")
    .digest("hex");

  const ba = Buffer.from(digest, "utf8");
  const bb = Buffer.from(hmac, "utf8");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Intercambia el authorization code por el token offline permanente.
export async function exchangeCodeForToken(params: {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
  code: string;
}): Promise<{ accessToken: string; scope: string }> {
  const res = await fetch(`https://${params.shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    scope?: string;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Intercambio de código falló (${res.status}): ${json.error_description ?? json.error ?? "sin detalle"}`
    );
  }
  return { accessToken: json.access_token, scope: json.scope ?? "" };
}

// Scopes faltantes en lo concedido. write_X satisface read_X (Shopify a veces
// solo reporta el write); así evitamos falsos negativos.
export function missingScopes(grantedScope: string): string[] {
  const granted = new Set(
    grantedScope
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return REQUIRED_SCOPES.filter((req) => {
    if (granted.has(req)) return false;
    if (req.startsWith("read_") && granted.has(req.replace("read_", "write_"))) return false;
    return true;
  });
}
