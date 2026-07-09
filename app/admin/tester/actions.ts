"use server";

// Probador del asesor (Feature G de la spec de operación). Conversa con
// runAssistant del tenant elegido SIN tocar WhatsApp ni el contador de consumo:
//  - UNA conversación is_test=true por tenant, teléfono sintético.
//  - Los mensajes se persisten (revisables luego) pero jamás se envían.
//  - crear_orden corre simulada y escalar_a_humano no crea ticket (testMode).
//  - Excluida de métricas, CRM, export y resumen (filtros por is_test).

import { requirePlatformAdmin } from "@/lib/admin/context";
import { runAssistant, type Content } from "@/lib/ai/gemini";
import { summarizeToolTrace } from "@/lib/ops/events";
import type { Tenant } from "@/lib/tenant";

const TEST_PHONE = "+570000000000";
const MAX_HISTORY = 24;

export type TesterToolCall = { name: string; args: string; ok: boolean; error?: string };

export type TesterState = {
  ok: boolean;
  error: string | null;
  reply: string | null;
  tools: TesterToolCall[];
  // URLs de imágenes que el asesor "envió" (se muestran en la UI del probador
  // en lugar de mandarse por WhatsApp).
  images: string[];
  exhausted: boolean;
};

const INITIAL_OK: Omit<TesterState, "ok" | "error"> = {
  reply: null,
  tools: [],
  images: [],
  exhausted: false,
};

async function getOrCreateTestConversation(
  admin: Awaited<ReturnType<typeof requirePlatformAdmin>>["admin"],
  tenantId: string
): Promise<string> {
  const { data: existing } = await admin
    .from("conversations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("customer_phone", TEST_PHONE)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from("conversations")
    .insert({
      tenant_id: tenantId,
      customer_phone: TEST_PHONE,
      status: "bot_active",
      is_test: true,
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(`No se pudo crear la conversación de prueba: ${error?.message}`);
  return created.id;
}

export async function sendTesterMessage(
  _prev: TesterState,
  fd: FormData
): Promise<TesterState> {
  const { admin } = await requirePlatformAdmin();
  const tenantId = String(fd.get("tenant_id") ?? "");
  const message = String(fd.get("message") ?? "").trim();
  if (!tenantId || !message) {
    return { ok: false, error: "Falta el tenant o el mensaje.", ...INITIAL_OK };
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("*")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) return { ok: false, error: "Tenant no encontrado.", ...INITIAL_OK };

  try {
    const conversationId = await getOrCreateTestConversation(admin, tenantId);

    // Persistir el turno del operador (sin wa_message_id: no viene de Meta).
    const { data: inserted, error: insErr } = await admin
      .from("messages")
      .insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        sender: "customer",
        msg_type: "text",
        content: message,
      })
      .select("id")
      .single();
    if (insErr || !inserted) throw new Error(insErr?.message ?? "insert falló");

    // Historial reciente en orden cronológico (mismo patrón del worker).
    const { data: recent } = await admin
      .from("messages")
      .select("id, sender, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(MAX_HISTORY);
    const history = (recent ?? []).reverse();
    const contents: Content[] = history.map((r) => ({
      role: r.sender === "customer" ? "user" : "model",
      parts: [{ text: r.content ?? "" }],
    }));

    // Sin shopify (crear_orden va simulada) y sin wa (nada sale por WhatsApp).
    const result = await runAssistant({
      tenant: tenant as Tenant,
      conversationId,
      customerPhone: TEST_PHONE,
      testMode: true,
      contents,
    });

    const reply = result.text?.trim() || null;
    if (reply) {
      await admin.from("messages").insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        sender: "bot",
        msg_type: "text",
        content: reply,
      });
    }

    // Imágenes que el asesor habría enviado (sandbox: la herramienta devuelve
    // la URL en lugar de mandarla).
    const images = result.toolTrace
      .filter((t) => t.name === "enviar_imagen_producto")
      .flatMap((t) => {
        const r = t.response as { imagen?: string; imagenes?: string[] } | undefined;
        return r?.imagenes ?? (r?.imagen ? [r.imagen] : []);
      })
      .filter((u): u is string => !!u);

    return {
      ok: true,
      error: null,
      reply,
      tools: summarizeToolTrace(result.toolTrace),
      images,
      exhausted: !!result.exhausted,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message, ...INITIAL_OK };
  }
}

// Reinicia la conversación de prueba del tenant: borra sus mensajes.
export async function resetTesterConversation(fd: FormData): Promise<void> {
  const { admin } = await requirePlatformAdmin();
  const tenantId = String(fd.get("tenant_id") ?? "");
  if (!tenantId) return;

  const { data: conv } = await admin
    .from("conversations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("customer_phone", TEST_PHONE)
    .eq("is_test", true)
    .maybeSingle();
  if (!conv) return;

  await admin.from("messages").delete().eq("conversation_id", conv.id);
  await admin
    .from("conversations")
    .update({ status: "bot_active", closed_at: null })
    .eq("id", conv.id);
}

// Mensajes persistidos de la conversación de prueba (para hidratar la UI).
export type TesterMessage = { id: string; sender: string; content: string | null };

export async function loadTesterMessages(tenantId: string): Promise<TesterMessage[]> {
  const { admin } = await requirePlatformAdmin();
  const { data: conv } = await admin
    .from("conversations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("customer_phone", TEST_PHONE)
    .eq("is_test", true)
    .maybeSingle();
  if (!conv) return [];
  const { data } = await admin
    .from("messages")
    .select("id, sender, content")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: true })
    .limit(200);
  return (data ?? []) as TesterMessage[];
}
