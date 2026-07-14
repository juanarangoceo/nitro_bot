// Setup y prueba de las alertas Telegram del dueño.
//
// Paso a paso:
//  1. Crea el bot: habla con @BotFather en Telegram → /newbot → copia el token.
//  2. Pon TELEGRAM_BOT_TOKEN=... en .env.local y MÁNDALE UN "hola" a tu bot.
//  3. Corre `npm run telegram:test` → sin TELEGRAM_CHAT_ID lista los chat_id
//     que le han escrito al bot; copia el tuyo a TELEGRAM_CHAT_ID.
//  4. Corre `npm run telegram:test` de nuevo → debe llegarte el mensaje ✅.
//  5. Carga ambas vars en Vercel (Production) y redeploy.

import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    console.log("Falta TELEGRAM_BOT_TOKEN en .env.local.");
    console.log("Crea el bot con @BotFather (/newbot) y pega aquí el token.");
    process.exit(1);
  }

  if (!chatId) {
    console.log("TELEGRAM_CHAT_ID no está configurado. Buscando chats que le han escrito al bot…");
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const json = (await res.json()) as {
      ok: boolean;
      result?: { message?: { chat?: { id: number; first_name?: string; username?: string } } }[];
    };
    if (!json.ok) {
      console.error("getUpdates falló:", JSON.stringify(json));
      process.exit(1);
    }
    const chats = new Map<number, string>();
    for (const u of json.result ?? []) {
      const c = u.message?.chat;
      if (c) chats.set(c.id, `${c.first_name ?? ""} ${c.username ? "@" + c.username : ""}`.trim());
    }
    if (chats.size === 0) {
      console.log("El bot no ha recibido mensajes. Ábrelo en Telegram, mándale un 'hola' y vuelve a correr esto.");
      process.exit(1);
    }
    console.log("Chats encontrados (usa el id como TELEGRAM_CHAT_ID):");
    for (const [id, name] of chats) console.log(`  TELEGRAM_CHAT_ID=${id}   # ${name}`);
    process.exit(0);
  }

  const { sendTelegramAlert } = await import("../lib/notify/telegram");
  await sendTelegramAlert(
    "✅ <b>Nitro Bot conectado a Telegram</b>\nRecibirás aquí: errores críticos 🔴, créditos de clientes al 80%/100% 🟠 y Solicitudes nuevas 📩."
  );
  console.log("Mensaje enviado. Si no te llegó, revisa TELEGRAM_CHAT_ID (y que le hayas escrito al bot antes).");
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
