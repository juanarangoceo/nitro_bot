// Webhook entrante de Telegram: el DUEÑO conversa con el asistente de
// operaciones (lib/notify/telegram-ai). Seguridad en tres capas:
//   1. `X-Telegram-Bot-Api-Secret-Token` debe coincidir con
//      TELEGRAM_WEBHOOK_SECRET (lo fija `npm run telegram:set-webhook`).
//   2. Solo se atiende el chat_id del dueño (TELEGRAM_CHAT_ID).
//   3. Sin las env vars, la ruta responde 404 (el bot queda solo-alertas).
// Se responde 200 rápido y la IA corre en la cola de fondo (patrón Meta).

import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/queue";
import { sendTelegramAlert, escTelegram } from "@/lib/notify/telegram";
import { answerOwnerQuestion } from "@/lib/notify/telegram-ai";

export const maxDuration = 60;

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number | string };
  };
};

export async function POST(req: Request) {
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  const ownerChatId = env.TELEGRAM_CHAT_ID;
  if (!secret || !ownerChatId) return new NextResponse(null, { status: 404 });

  if (req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new NextResponse(null, { status: 401 });
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  const text = update?.message?.text?.trim();
  const chatId = String(update?.message?.chat?.id ?? "");

  // Cualquier otro chat o update sin texto se ignora con 200 (Telegram
  // reintenta los no-200; no queremos loops por stickers o desconocidos).
  if (!text || chatId !== ownerChatId) return NextResponse.json({ ok: true });

  if (text === "/start") {
    enqueue(() =>
      sendTelegramAlert(
        "👋 Soy el asistente de operaciones de Nitro Bot. Pregúntame por errores, consumo de clientes, ventas del día o el estado del sistema. Respondo corto."
      )
    );
    return NextResponse.json({ ok: true });
  }

  enqueue(async () => {
    const answer = await answerOwnerQuestion(text);
    // escTelegram: la respuesta libre de la IA podría traer < o & y el
    // parse_mode HTML rechazaría el mensaje completo.
    await sendTelegramAlert(escTelegram(answer));
  });

  return NextResponse.json({ ok: true });
}
