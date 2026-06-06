// Registro (idempotente) de los webhooks de catálogo de Shopify para un tenant.
// Compartido por scripts/register-shopify-webhooks.ts y el panel. Solo registra
// los topics que el route sabe manejar (products/create|update|delete).

import { getTenantBySlug } from "../tenant";
import { shopifyGraphQL, type ShopifyCreds } from "../shopify/client";

const TOPICS = ["PRODUCTS_CREATE", "PRODUCTS_UPDATE", "PRODUCTS_DELETE"] as const;

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

// Registra/actualiza los 3 topics. Devuelve un resumen por topic.
export async function registerShopifyWebhooks(
  slug: string,
  baseUrl: string
): Promise<{ topic: string; action: "created" | "updated" | "exists" }[]> {
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
  const out: { topic: string; action: "created" | "updated" | "exists" }[] = [];
  for (const topic of TOPICS) {
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
  }
  return out;
}
