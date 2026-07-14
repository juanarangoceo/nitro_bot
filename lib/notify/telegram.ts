// Alertas por Telegram al DUEÑO de la plataforma (Juan), no a los clientes:
// errores críticos, créditos de tenants al 80%/100% y Solicitudes nuevas.
// Feature C de la spec de operación. Bot API pura vía fetch (sin SDK).
//
// Best-effort blindado (patrón de email.ts/tts.ts): JAMÁS lanza. Sin
// TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID es un no-op silencioso, así que se
// puede desplegar sin configurar y la app queda idéntica.
//
// OJO: los fallos van SOLO a console.error, nunca a logEvent — logEvent llama
// a este módulo en severity=error y se formaría recursión.

import { env } from "../env";

const TIMEOUT_MS = 10_000;

// Escapa el texto para parse_mode HTML de Telegram (solo <, > y &).
export function escTelegram(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendTelegramAlert(text: string): Promise<void> {
  try {
    const token = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return; // no configurado → no-op

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[telegram] sendMessage falló (${res.status}): ${body.slice(0, 300)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error("[telegram] alerta no enviada:", (e as Error).message);
  }
}
