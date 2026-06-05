"use server";

// Acciones del editor del asesor.
// - updateSystemPrompt: el UPDATE va por el cliente service_role pero SIEMPRE
//   acotado al tenant del usuario autenticado (id tomado del contexto con RLS) y
//   solo toca la columna system_prompt. Así evitamos abrir una política de UPDATE
//   amplia sobre tenants para authenticated.
// - testAssistant: corre el asesor con el prompt YA GUARDADO sobre un mensaje de
//   prueba (sandbox, sin persistir conversación).

import { getDashboardContext } from "@/lib/dashboard/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantBySlug } from "@/lib/tenant";
import { runAssistant } from "@/lib/ai/gemini";
import { revalidatePath } from "next/cache";

export type SaveState = { ok: boolean; error: string | null };

export async function updateSystemPrompt(
  _prev: SaveState,
  formData: FormData
): Promise<SaveState> {
  const { tenant } = await getDashboardContext();
  const prompt = String(formData.get("system_prompt") ?? "").trim();
  if (prompt.length < 20) {
    return { ok: false, error: "El prompt es muy corto (mínimo 20 caracteres)." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("tenants")
    .update({ system_prompt: prompt })
    .eq("id", tenant.id);
  if (error) return { ok: false, error: "No se pudo guardar." };

  revalidatePath("/dashboard/editor");
  return { ok: true, error: null };
}

export type TestState = { reply: string | null; tools: string[]; error: string | null };

export async function testAssistant(
  _prev: TestState,
  formData: FormData
): Promise<TestState> {
  const { tenant } = await getDashboardContext();
  const message = String(formData.get("message") ?? "").trim();
  if (!message) return { reply: null, tools: [], error: "Escribe un mensaje de prueba." };
  if (!tenant.slug) return { reply: null, tools: [], error: "Tenant sin slug." };

  try {
    const resolved = await getTenantBySlug(tenant.slug);
    if (!resolved) return { reply: null, tools: [], error: "Tenant no encontrado." };

    const shopify =
      resolved.tenant.shopify_domain && resolved.secrets.shopify_access_token
        ? {
            domain: resolved.tenant.shopify_domain,
            accessToken: resolved.secrets.shopify_access_token,
          }
        : undefined;

    const result = await runAssistant({
      tenant: resolved.tenant,
      shopify,
      contents: [{ role: "user", parts: [{ text: message }] }],
    });
    return { reply: result.text, tools: result.toolTrace.map((t) => t.name), error: null };
  } catch (e) {
    return { reply: null, tools: [], error: (e as Error).message };
  }
}
