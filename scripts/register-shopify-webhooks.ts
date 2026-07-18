// Registra (idempotente) los webhooks de catálogo de Shopify para un tenant.
// Wrapper delgado sobre lib/provisioning/webhooks.ts.
//
// Uso:
//   WEBHOOK_BASE_URL=https://<tu-deploy>.vercel.app \
//   SEED_TENANT_SLUG=elegance-dev \                  # opcional (default)
//   npm run register:shopify-webhooks

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { registerShopifyWebhooks, shopifyWebhookUrl } from "../lib/provisioning/webhooks";

function resolveBaseUrl(): string {
  const full = process.env.SHOPIFY_WEBHOOK_URL;
  if (full) return full.replace(/\/api\/webhooks\/shopify\/?$/, "");
  const base = process.env.WEBHOOK_BASE_URL ?? process.env.APP_BASE_URL;
  if (!base) {
    throw new Error("Falta WEBHOOK_BASE_URL (o SHOPIFY_WEBHOOK_URL) en el entorno");
  }
  return base;
}

async function main() {
  const baseUrl = resolveBaseUrl();
  const slug = process.env.SEED_TENANT_SLUG ?? "elegance-dev";

  console.log(`Tenant:   ${slug}`);
  console.log(`Callback: ${shopifyWebhookUrl(baseUrl)}\n`);

  const result = await registerShopifyWebhooks(slug, baseUrl);
  for (const r of result) {
    const icon =
      r.action === "created"
        ? "✅ creado"
        : r.action === "updated"
          ? "♻️  actualizado"
          : r.action === "failed"
            ? "❌ falló"
            : "⏭️  ya existe";
    console.log(`  ${icon} ${r.topic}${r.error ? ` — ${r.error}` : ""}`);
  }

  console.log("\nListo. Edita un producto en Shopify dev para probar el sync en vivo.");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
