// Embeddings con Gemini vía REST (sin SDK). Server-side: usa GEMINI_API_KEY.
// Dimensión fija 768 para coincidir con products.embedding vector(768).

import { env } from "../env";

const MODEL = "gemini-embedding-001";
const DIM = 768;
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`;

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

async function embed(text: string, taskType: TaskType): Promise<number[]> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      content: { parts: [{ text: text.slice(0, 8000) }] },
      outputDimensionality: DIM,
      taskType,
    }),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Gemini embed falló: ${json.error?.message ?? res.status}`);
  }
  const values = json.embedding?.values as number[] | undefined;
  if (!values || values.length !== DIM) {
    throw new Error(`Embedding inesperado (dims=${values?.length})`);
  }
  return values;
}

// Para indexar un producto del catálogo.
export function embedDocument(text: string): Promise<number[]> {
  return embed(text, "RETRIEVAL_DOCUMENT");
}

// Para una consulta del cliente (RAG).
export function embedQuery(text: string): Promise<number[]> {
  return embed(text, "RETRIEVAL_QUERY");
}

export { DIM as EMBEDDING_DIM, MODEL as EMBEDDING_MODEL };
