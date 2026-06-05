// Registra (idempotente) los webhooks de catálogo de Shopify para un tenant,
// apuntando a /api/webhooks/shopify del deploy. Reusa las credenciales cifradas
// del tenant (Admin API GraphQL). Los webhooks creados vía Admin API se firman
// con el API secret de la app → el route los valida con shopify_webhook_secret.
//
// Solo registra los topics que el route sabe manejar correctamente
// (products/create|update|delete). El stock se actualiza porque cada
// products/update re-sincroniza el producto completo (incluye totalInventory).
//
// Uso:
//   WEBHOOK_BASE_URL=https://<tu-deploy>.vercel.app \
//   SEED_TENANT_SLUG=elegance-dev \                  # opcional (default)
//   npm run register:shopify-webhooks
//
// Alternativa: SHOPIFY_WEBHOOK_URL=https://.../api/webhooks/shopify (URL completa).

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getTenantBySlug } from "../lib/tenant";
import { shopifyGraphQL, type ShopifyCreds } from "../lib/shopify/client";

const TOPICS = ["PRODUCTS_CREATE", "PRODUCTS_UPDATE", "PRODUCTS_DELETE"] as const;

type HttpSub = { id: string; topic: string; callbackUrl: string | null };

function resolveCallbackUrl(): string {
  const full = process.env.SHOPIFY_WEBHOOK_URL;
  if (full) return full;
  const base = process.env.WEBHOOK_BASE_URL;
  if (!base) {
    throw new Error("Falta WEBHOOK_BASE_URL (o SHOPIFY_WEBHOOK_URL) en el entorno");
  }
  return `${base.replace(/\/+$/, "")}/api/webhooks/shopify`;
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

type UserErrors = { userErrors: { field: string[] | null; message: string }[] };

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

async function main() {
  const callbackUrl = resolveCallbackUrl();
  const slug = process.env.SEED_TENANT_SLUG ?? "elegance-dev";

  const r = await getTenantBySlug(slug);
  if (!r) throw new Error(`tenant "${slug}" no encontrado`);
  if (!r.tenant.shopify_domain || !r.secrets.shopify_access_token) {
    throw new Error(`tenant "${slug}" sin credenciales de Shopify`);
  }
  const creds: ShopifyCreds = {
    domain: r.tenant.shopify_domain,
    accessToken: r.secrets.shopify_access_token,
  };

  console.log(`Tenant:   ${r.tenant.name}`);
  console.log(`Callback: ${callbackUrl}\n`);

  const existing = await listExisting(creds);

  for (const topic of TOPICS) {
    const match = existing.find((s) => s.topic === topic);
    if (!match) {
      await createSub(creds, topic, callbackUrl);
      console.log(`  ✅ creado   ${topic}`);
    } else if (match.callbackUrl !== callbackUrl) {
      await updateSub(creds, match.id, callbackUrl);
      console.log(`  ♻️  actualizado ${topic} (URL nueva)`);
    } else {
      console.log(`  ⏭️  ya existe ${topic}`);
    }
  }

  console.log("\nListo. Edita un producto en Shopify dev para probar el sync en vivo.");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
