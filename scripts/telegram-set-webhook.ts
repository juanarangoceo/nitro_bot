// Registra el webhook del asistente conversacional de Telegram.
//
// Requisitos en .env.local (y en Vercel Production):
//   TELEGRAM_BOT_TOKEN      — el del bot de alertas (mismo bot)
//   TELEGRAM_CHAT_ID        — chat del dueño (npm run telegram:test lo lista)
//   TELEGRAM_WEBHOOK_SECRET — cadena aleatoria (ej: openssl rand -hex 24)
//   APP_BASE_URL            — https://nitro-bot-coral.vercel.app
//
// Uso:
//   npm run telegram:set-webhook          # registra
//   npm run telegram:set-webhook -- off   # lo elimina (bot vuelve a solo-alertas)

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const base = process.env.APP_BASE_URL;
  if (!token) throw new Error("Falta TELEGRAM_BOT_TOKEN en .env.local");

  if (process.argv.includes("off")) {
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
    console.log("deleteWebhook:", JSON.stringify(await res.json()));
    return;
  }

  if (!secret) throw new Error("Falta TELEGRAM_WEBHOOK_SECRET (genera una: openssl rand -hex 24)");
  if (!base) throw new Error("Falta APP_BASE_URL");

  const url = `${base.replace(/\/$/, "")}/api/telegram/webhook`;
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    }),
  });
  console.log("setWebhook →", url);
  console.log(JSON.stringify(await res.json()));

  const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  console.log("getWebhookInfo:", JSON.stringify((await info.json()).result));
  console.log(
    "\nListo: escribe cualquier pregunta al bot en Telegram y el asistente responde.\nOJO: TELEGRAM_WEBHOOK_SECRET también debe estar en Vercel Production."
  );
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
