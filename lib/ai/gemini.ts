// Cliente Gemini (REST) con loop de function calling y entrada multimodal.
// Modelo por defecto: gemini-3.5-flash (configurable por tenant).
//
// Notas Gemini 3.x (importantes):
// - NO enviar temperature/top_p/top_k (la API los desaconseja en 3.x).
// - Usar thinkingLevel (no thinkingBudget). 'low' = fiable en tool-calling con
//   baja latencia/costo para chat.
// - Function calling estricto: cada functionResponse debe incluir el `id` del
//   functionCall, con name y conteo coincidentes, o el modelo devuelve vacío.
// - Thought signatures: se preservan reenviando los `parts` del modelo SIN
//   modificar (incluyen el campo thoughtSignature).

import { env } from "../env";
import { buildSystemPrompt } from "./prompt";
import { toolDeclarations, executeTool, type ToolContext } from "./tools";
import type { ShopifyCreds } from "../shopify/client";
import type { WaCreds } from "../whatsapp/meta";
import type { Tenant } from "../tenant";

// Parts dinámicos (texto | functionCall | functionResponse | inlineData |
// thoughtSignature). Tipado laxo a propósito para no perder campos de la API.
export type GeminiPart = Record<string, unknown>;
export type Content = { role: "user" | "model"; parts: GeminiPart[] };

const THINKING_LEVEL = "low";
const MAX_TOOL_ROUNDS = 5;

function endpoint(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

async function generate(
  model: string,
  systemPrompt: string,
  contents: Content[],
  opts?: { disableTools?: boolean }
) {
  const res = await fetch(endpoint(model), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      tools: [{ functionDeclarations: toolDeclarations }],
      // mode NONE fuerza una respuesta de texto (cierre del turno) sin quitar
      // las declaraciones: se usa para el intento final tras agotar el loop.
      ...(opts?.disableTools
        ? { toolConfig: { functionCallingConfig: { mode: "NONE" } } }
        : {}),
      generationConfig: { thinkingConfig: { thinkingLevel: THINKING_LEVEL } },
    }),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Gemini generate falló: ${json.error?.message ?? res.status}`);
  }
  return json;
}

// Consumo de tokens del turno (suma de TODAS las llamadas: cada ronda del loop
// re-paga el input completo, así que promptTokens refleja lo realmente
// facturado). Viene de usageMetadata de la API.
export type GeminiUsage = {
  calls: number;
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number; // thinking: se factura como salida
  cachedTokens: number; // parte del input con descuento de caché implícito
  audioTokens: number; // parte del input facturada a tarifa de audio
};

export function emptyUsage(): GeminiUsage {
  return { calls: 0, promptTokens: 0, outputTokens: 0, thoughtsTokens: 0, cachedTokens: 0, audioTokens: 0 };
}

type UsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  promptTokensDetails?: { modality?: string; tokenCount?: number }[];
};

// Acumula el usageMetadata de una respuesta sobre `acc`. Reusable por los
// llamadores que hacen su propio fetch (recordatorios).
export function accumulateUsage(acc: GeminiUsage, json: unknown): void {
  const u = (json as { usageMetadata?: UsageMetadata })?.usageMetadata;
  if (!u) return;
  acc.calls += 1;
  acc.promptTokens += u.promptTokenCount ?? 0;
  acc.outputTokens += u.candidatesTokenCount ?? 0;
  acc.thoughtsTokens += u.thoughtsTokenCount ?? 0;
  acc.cachedTokens += u.cachedContentTokenCount ?? 0;
  for (const d of u.promptTokensDetails ?? []) {
    if (d.modality === "AUDIO") acc.audioTokens += d.tokenCount ?? 0;
  }
}

export type AssistantResult = {
  text: string;
  toolTrace: { name: string; args: unknown; response: unknown }[];
  // Tokens consumidos por el turno completo (todas las rondas). Opcional para
  // no cambiar el contrato de llamadores existentes.
  usage?: GeminiUsage;
  // true si el loop agotó MAX_TOOL_ROUNDS sin respuesta final: el asesor quedó
  // trabado (p. ej. una herramienta falla en bucle). El worker escala a humano
  // en lugar de dejar al cliente en un callejón sin salida. Opcional para no
  // cambiar el contrato de los llamadores que no la usan.
  exhausted?: boolean;
};

// Ejecuta el asesor sobre el historial dado y devuelve el texto final + la
// traza de herramientas usadas (útil para el dashboard y para depurar).
export async function runAssistant(params: {
  tenant: Tenant;
  conversationId?: string;
  shopify?: ShopifyCreds;
  wa?: WaCreds;
  customerPhone?: string;
  testMode?: boolean;
  // Instrucción adicional del turno (p. ej. "la respuesta será una nota de
  // voz: sé conciso"). Se anexa al system prompt sin tocar el del tenant.
  extraSystem?: string;
  contents: Content[];
}): Promise<AssistantResult> {
  const { tenant, conversationId, shopify, wa, customerPhone, testMode, extraSystem, contents } = params;
  const systemPrompt = extraSystem
    ? `${buildSystemPrompt(tenant)}\n\n${extraSystem}`
    : buildSystemPrompt(tenant);
  const ctx: ToolContext = {
    tenant,
    conversationId,
    shopify,
    wa,
    customerPhone,
    testMode,
    calledTools: new Set<string>(),
  };
  const working: Content[] = [...contents];
  const toolTrace: AssistantResult["toolTrace"] = [];
  const usage = emptyUsage();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const json = await generate(tenant.ai_model, systemPrompt, working);
    accumulateUsage(usage, json);
    const parts = (json.candidates?.[0]?.content?.parts ?? []) as GeminiPart[];
    const calls = parts.filter((p) => p.functionCall);

    if (calls.length === 0) {
      const text = parts
        .map((p) => (typeof p.text === "string" ? p.text : ""))
        .join("")
        .trim();
      return { text, toolTrace, usage };
    }

    // Reenviamos los parts del modelo SIN modificar (preserva thoughtSignature).
    working.push({ role: "model", parts });

    // Una functionResponse por cada functionCall, con id y name coincidentes.
    const responseParts: GeminiPart[] = [];
    for (const call of calls) {
      const fc = call.functionCall as { name: string; args?: Record<string, unknown>; id?: string };
      let response: unknown;
      try {
        response = await executeTool(fc.name, fc.args ?? {}, ctx);
      } catch (e) {
        response = { error: (e as Error).message };
      }
      toolTrace.push({ name: fc.name, args: fc.args, response });
      const fr: Record<string, unknown> = { name: fc.name, response };
      if (fc.id) fr.id = fc.id;
      responseParts.push({ functionResponse: fr });
    }
    working.push({ role: "user", parts: responseParts });
  }

  // Loop agotado: antes de rendirse (y de que el worker escale a humano), UNA
  // llamada final con function calling apagado para que el modelo cierre el
  // turno con lo que ya recopiló. Solo si también esto falla queda `exhausted`.
  try {
    const json = await generate(tenant.ai_model, systemPrompt, working, { disableTools: true });
    accumulateUsage(usage, json);
    const parts = (json.candidates?.[0]?.content?.parts ?? []) as GeminiPart[];
    const text = parts
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("")
      .trim();
    if (text) return { text, toolTrace, usage };
  } catch (e) {
    console.error("[gemini] intento final sin tools falló:", e);
  }

  return {
    text: "Disculpa, no logré completar la respuesta. ¿Me lo repites?",
    toolTrace,
    usage,
    exhausted: true,
  };
}
