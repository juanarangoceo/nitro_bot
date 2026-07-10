// TTS de respuestas de voz con Mistral (Voxtral) vía REST, sin SDK.
// Feature premium por tenant: el texto lo genera Gemini (mismo cerebro y
// narrativa); aquí solo se convierte a nota de voz. SIEMPRE best-effort: un
// fallo de TTS jamás tumba el flujo — devuelve null y el worker responde texto.
// Sin MISTRAL_API_KEY o sin voz resuelta → no-op (null).

import { env } from "../env";
import { logEvent } from "../ops/events";

const MISTRAL_TTS_URL = "https://api.mistral.ai/v1/audio/speech";
const MISTRAL_TTS_MODEL = "voxtral-mini-tts-2603";
const TIMEOUT_MS = 15_000;

// Voxtral recomienda entradas cortas (<300 palabras). Por encima del cap es
// mejor mandar el texto completo por WhatsApp que un audio kilométrico: las
// notas de voz del bot deben ser breves (la instrucción de voz pide ≤2 frases).
const MAX_INPUT_CHARS = 600;

// El texto que llega viene pensado para chat: se limpia para que suene natural
// hablado (los docs de Voxtral piden evitar markdown, emojis y URLs).
export function sanitizeForSpeech(text: string): string {
  return (
    text
      // URLs no se leen en voz alta.
      .replace(/https?:\/\/\S+/g, "")
      // Markdown: énfasis, código y encabezados.
      .replace(/[*_`#~]+/g, "")
      // Viñetas de lista al inicio de línea.
      .replace(/^\s*[-•]\s+/gm, "")
      // Emojis y pictogramas.
      .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}

// Sintetiza `text` con la voz dada (o la global). Devuelve el audio OGG/Opus
// listo para WhatsApp, o null ante cualquier problema (queda traza tts_failure).
export async function synthesizeSpeech(params: {
  text: string;
  voiceId?: string | null;
  tenantId?: string | null;
  conversationId?: string | null;
}): Promise<{ bytes: Buffer; mimeType: "audio/ogg" } | null> {
  const apiKey = env.MISTRAL_API_KEY;
  const voiceId = params.voiceId ?? env.MISTRAL_VOICE_ID;
  if (!apiKey || !voiceId) return null; // no configurado: silencio total

  const input = sanitizeForSpeech(params.text);
  if (!input) return null;
  if (input.length > MAX_INPUT_CHARS) {
    // Demasiado largo para una nota de voz razonable: mejor texto.
    return null;
  }

  try {
    const res = await fetch(MISTRAL_TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MISTRAL_TTS_MODEL,
        input,
        voice_id: voiceId,
        // Opus: el único formato que WhatsApp acepta como nota de voz.
        response_format: "opus",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Mistral TTS HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as { audio_data?: string };
    if (!json.audio_data) throw new Error("Mistral TTS sin audio_data en la respuesta");
    const bytes = Buffer.from(json.audio_data, "base64");
    if (bytes.length === 0) throw new Error("Mistral TTS devolvió audio vacío");
    return { bytes, mimeType: "audio/ogg" };
  } catch (e) {
    await logEvent({
      kind: "tts_failure",
      severity: "warning",
      tenantId: params.tenantId ?? null,
      conversationId: params.conversationId ?? null,
      detail: { error: (e as Error).message, chars: input.length },
    });
    return null;
  }
}
