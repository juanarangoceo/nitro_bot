// Endpoint interno de prueba del asesor — SIN WhatsApp.
// Permite conversar con la IA por HTTP para validar RAG + function calling.
// Deshabilitado en producción.
//
//   POST /api/dev/chat
//   { "message": "hola, buscan tablas de snowboard?", "tenantSlug": "elegance-dev" }
//   o con historial multimodal: { "contents": [...], "tenantSlug": "..." }

import { NextResponse } from "next/server";
import { getTenantBySlug } from "@/lib/tenant";
import { runAssistant, type Content } from "@/lib/ai/gemini";

export async function POST(req: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return new Response("not found", { status: 404 });
  }

  const body = (await req.json()) as {
    message?: string;
    contents?: Content[];
    tenantSlug?: string;
  };

  const resolved = await getTenantBySlug(body.tenantSlug ?? "elegance-dev");
  if (!resolved) {
    return NextResponse.json({ error: "tenant no encontrado" }, { status: 404 });
  }

  const contents: Content[] =
    body.contents ?? [{ role: "user", parts: [{ text: body.message ?? "" }] }];

  const shopify =
    resolved.tenant.shopify_domain && resolved.secrets.shopify_access_token
      ? {
          domain: resolved.tenant.shopify_domain,
          accessToken: resolved.secrets.shopify_access_token,
        }
      : undefined;

  try {
    const result = await runAssistant({ tenant: resolved.tenant, shopify, contents });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
