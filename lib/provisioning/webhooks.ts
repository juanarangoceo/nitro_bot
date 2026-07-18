// Registro (idempotente) de los webhooks de Shopify para un tenant.
// Compartido por scripts/register-shopify-webhooks.ts y el panel. Solo registra
// los topics que el route sabe manejar: catálogo (products/*) y carritos
// abandonados (checkouts/* + orders/create, Spec 13).
//
// OJO scopes: CHECKOUTS_* exige read_checkouts y ORDERS_CREATE read_orders en
// la app del tenant. Si un topic falla por permisos, se reporta como "failed"
// SIN tumbar el registro de los demás (los tenants sin el módulo de carritos
// igual pueden operar solo con products/*).

import { getTenantBySlug } from "../tenant";
import { shopifyGraphQL, type ShopifyCreds } from "../shopify/client";

const TOPICS = [
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "CHECKOUTS_CREATE",
  "CHECKOUTS_UPDATE",
  "ORDERS_CREATE",
] as const;

type HttpSub = { id: string; topic: string; callbackUrl: string | null };
type UserErrors = { userErrors: { field: string[] | null; message: string }[] };

export function shopifyWebhookUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/webhooks/shopify`;
}

async function listExisting(creds: ShopifyCreds): Promise<HttpSub[]> {
  const data = await shopifyGraphQL<{
    webhookSubscriptions: {
      edges: {
        node: {
          id: string;
          topic: string;
          endpoint: { __typename: string; callbackUrl?: string };
        };
      }[];
    };
  }>(
    creds,
    `query {
      webhookSubscriptions(first: 100) {
        edges { node {
          id topic
          endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } }
        } }
      }
    }`
  );
  return data.webhookSubscriptions.edges
    .filter((e) => e.node.endpoint.__typename === "WebhookHttpEndpoint")
    .map((e) => ({
      id: e.node.id,
      topic: e.node.topic,
      callbackUrl: e.node.endpoint.callbackUrl ?? null,
    }));
}

async function createSub(creds: ShopifyCreds, topic: string, callbackUrl: string) {
  const data = await shopifyGraphQL<{ webhookSubscriptionCreate: UserErrors }>(
    creds,
    `mutation($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
        webhookSubscription { id }
        userErrors { field message }
      }
    }`,
    { topic, sub: { callbackUrl, format: "JSON" } }
  );
  const errs = data.webhookSubscriptionCreate.userErrors;
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
}

async function updateSub(creds: ShopifyCreds, id: string, callbackUrl: string) {
  const data = await shopifyGraphQL<{ webhookSubscriptionUpdate: UserErrors }>(
    creds,
    `mutation($id: ID!, $sub: WebhookSubscriptionInput!) {
      webhookSubscriptionUpdate(id: $id, webhookSubscription: $sub) {
        webhookSubscription { id }
        userErrors { field message }
      }
    }`,
    { id, sub: { callbackUrl, format: "JSON" } }
  );
  const errs = data.webhookSubscriptionUpdate.userErrors;
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
}

// Registra/actualiza los topics. Devuelve un resumen por topic; un fallo en un
// topic (p.ej. scope faltante) no impide los demás.
export async function registerShopifyWebhooks(
  slug: string,
  baseUrl: string
): Promise<{ topic: string; action: "created" | "updated" | "exists" | "failed"; error?: string }[]> {
  const callbackUrl = shopifyWebhookUrl(baseUrl);
  const r = await getTenantBySlug(slug);
  if (!r) throw new Error(`tenant "${slug}" no encontrado`);
  if (!r.tenant.shopify_domain || !r.secrets.shopify_access_token) {
    throw new Error(`tenant "${slug}" sin credenciales de Shopify`);
  }
  const creds: ShopifyCreds = {
    domain: r.tenant.shopify_domain,
    accessToken: r.secrets.shopify_access_token,
  };

  const existing = await listExisting(creds);
  const out: { topic: string; action: "created" | "updated" | "exists" | "failed"; error?: string }[] =
    [];
  for (const topic of TOPICS) {
    try {
      const match = existing.find((s) => s.topic === topic);
      if (!match) {
        await createSub(creds, topic, callbackUrl);
        out.push({ topic, action: "created" });
      } else if (match.callbackUrl !== callbackUrl) {
        await updateSub(creds, match.id, callbackUrl);
        out.push({ topic, action: "updated" });
      } else {
        out.push({ topic, action: "exists" });
      }
    } catch (e) {
      out.push({ topic, action: "failed", error: (e as Error).message });
    }
  }
  return out;
}
