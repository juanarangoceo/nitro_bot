// Carritos abandonados — lado de ENVÍO (cron cada 15 min).
// Selecciona checkouts con recordatorio vencido y envía la plantilla de
// marketing de Meta (máx 2 por checkout, estados solo hacia adelante).
//
// Reglas duras, TODAS server-side y en este orden:
//   1. Ventana horaria 8:00–20:00 America/Bogota (fuera de ella el barrido
//      entero es no-op; lo vencido sale en la siguiente corrida en ventana).
//   2. Tenant activo + módulo encendido + checkout_url_base configurada.
//   3. Máx 1 recordatorio de carrito por comprador por día (día Bogotá); con
//      varios checkouts vencidos del mismo comprador gana el más reciente y
//      los demás expiran SOLO si el ganador realmente sale (si se posterga,
//      vuelven a competir en la siguiente corrida).
//   4. Comprador sin marketing_opt_out.
//   5. No molestar a quien ya está hablando: conversación escalada
//      (requires_human/human_active) o con el cliente escribiendo hace <4h →
//      se posterga.
//   6. Doble verificación de compra: si el bot ya le creó una orden después
//      del abandono, el checkout se cierra sin enviar.
//   7. El botón debe reconstruir un link válido: la URL del checkout empieza
//      por la base configurada (viaja el resto como sufijo) o, si no, se
//      extrae el token de /checkouts/ac|cn/{token} del MISMO dominio y viaja
//      solo el token (la base de la plantilla termina en /checkouts/cn/ y
//      Shopify recupera el carrito desde ese formato). Sin link válido → no
//      se envía y el checkout expira (un botón roto es peor que no enviar).
//   8. Meta rechaza el envío → máx 1 reintento en la corrida siguiente,
//      luego expired.
//
// Telemetría de facturación (obligatoria): cada plantilla enviada inserta
// event_log kind wa_template_usage — es la fuente de verdad del consumo.
// Las variables de la plantilla se generan AQUÍ, nunca por el modelo.

import { createAdminClient } from "../supabase/admin";
import { getTenantByPhoneNumberId, type Tenant } from "../tenant";
import { sendTemplate, type WaCreds } from "../whatsapp/meta";
import { logEvent } from "../ops/events";
import { formatCop } from "../billing";
import { bogotaDayIso, bogotaDayStart } from "../dates";
import { cartSettings, CART_TEMPLATE_UNIT_COST_USD, type CartSettings } from "./settings";

const SEND_WINDOW = { from: 8, to: 20 } as const; // [8:00, 20:00) Bogotá
const MIN_GAP_BETWEEN_REMINDERS_MS = 2 * 3_600_000; // anti-solape del cron
const ACTIVE_CHAT_COOLDOWN_MS = 4 * 3_600_000; // cliente escribiendo → posterga
const MAX_PER_TENANT = 200;

type CheckoutRow = {
  id: string;
  phone: string;
  customer_name: string | null;
  line_items: { title?: string; quantity?: number }[];
  total_price: number | null;
  abandoned_checkout_url: string | null;
  status: "pending" | "reminded_1";
  created_at: string;
  last_activity_at: string;
  reminder_1_sent_at: string | null;
  send_attempts: number;
};

function bogotaHour(now: Date): number {
  return (now.getUTCHours() - 5 + 24) % 24;
}

// Sufijo del botón de la plantilla (la base vive FIJA en la plantilla de
// Meta). La abandoned_checkout_url real de Shopify es
// /{store_id}/checkouts/ac/{token}/recover?key=… — no empieza por la base
// pública /checkouts/cn/, pero el mismo token en /checkouts/cn/{token}
// restaura el carrito (verificado 2026-07-18 contra la tienda real: redirige
// a una sesión nueva con los mismos ítems). Solo se acepta el token si la URL
// es del MISMO host que la base (una tienda dev jamás calza con la base de
// producción). Sin sufijo válido → null (el caller expira el checkout).
export function buttonSuffix(url: string, base: string): string | null {
  if (url.startsWith(base) && url.length > base.length) return url.slice(base.length);
  try {
    if (new URL(url).host !== new URL(base).host) return null;
  } catch {
    return null;
  }
  return /\/checkouts\/(?:ac|cn)\/([A-Za-z0-9_-]+)/.exec(url)?.[1] ?? null;
}

// "Zapatos de tacón rojo talla…" (+ " y 2 más" si el carrito trae más ítems).
// Shopify a veces manda title "" (ítems custom/draft): `||` en vez de `??`
// para que el vacío también caiga al fallback — un parámetro vacío rompe el
// envío de la plantilla en Meta.
export function describeItems(items: CheckoutRow["line_items"]): string {
  const first = (items?.[0]?.title || "tu pedido").slice(0, 60).trim() || "tu pedido";
  const rest = (items?.length ?? 0) - 1;
  return rest > 0 ? `${first} y ${rest} más` : first;
}

// Meta rechaza parámetros de plantilla vacíos o con saltos de línea/tabs.
function cleanParam(s: string): string {
  return s.replace(/\s+/g, " ").trim() || "-";
}

async function getOrCreateConversation(
  tenantId: string,
  phone: string
): Promise<string | null> {
  const supabase = createAdminClient();
  // ignoreDuplicates: si ya existe NO se pisa su estado ni sus timestamps.
  const { data: inserted } = await supabase
    .from("conversations")
    .upsert(
      { tenant_id: tenantId, customer_phone: phone, status: "bot_active" },
      { onConflict: "tenant_id,customer_phone", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();
  if (inserted) return inserted.id;
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("customer_phone", phone)
    .maybeSingle();
  return existing?.id ?? null;
}

async function processCheckout(params: {
  tenant: Tenant;
  wa: WaCreds;
  settings: CartSettings;
  row: CheckoutRow;
  sentTodayPhones: Set<string>;
}): Promise<"sent" | "skipped" | "expired"> {
  const { tenant, wa, settings, row, sentTodayPhones } = params;
  const supabase = createAdminClient();
  const phase: 1 | 2 = row.status === "pending" ? 1 : 2;

  const terminal = async (status: "expired" | "opted_out" | "recovered" | "cancelled", extra?: Record<string, unknown>) => {
    await supabase
      .from("abandoned_checkouts")
      .update({ status, updated_at: new Date().toISOString(), ...extra })
      .eq("id", row.id);
  };

  // 3) Máx 1 por comprador por día.
  if (sentTodayPhones.has(row.phone)) return "skipped";

  // Anti-solape: mínimo 2h entre el recordatorio 1 y el 2.
  if (
    phase === 2 &&
    row.reminder_1_sent_at &&
    Date.now() - new Date(row.reminder_1_sent_at).getTime() < MIN_GAP_BETWEEN_REMINDERS_MS
  ) {
    return "skipped";
  }

  // 4) Opt-out del comprador.
  const { data: customer } = await supabase
    .from("customers")
    .select("marketing_opt_out")
    .eq("tenant_id", tenant.id)
    .eq("phone", row.phone)
    .maybeSingle();
  if (customer?.marketing_opt_out) {
    await terminal("opted_out");
    return "expired";
  }

  // 4b) Número bloqueado por el tenant (/dashboard/blocklist): sin marketing.
  const { data: blocked } = await supabase
    .from("blocked_numbers")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("phone", row.phone)
    .maybeSingle();
  if (blocked) {
    await terminal("expired");
    return "expired";
  }

  // 5) y 6) Estado de la conversación + orden ya creada por el bot.
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, status, last_customer_message_at")
    .eq("tenant_id", tenant.id)
    .eq("customer_phone", row.phone)
    .maybeSingle();
  if (conv) {
    if (conv.status === "requires_human" || conv.status === "human_active") {
      return "skipped"; // un humano lo está atendiendo; se posterga
    }
    if (
      conv.last_customer_message_at &&
      Date.now() - new Date(conv.last_customer_message_at).getTime() < ACTIVE_CHAT_COOLDOWN_MS
    ) {
      return "skipped"; // el cliente está escribiendo hace poco; se posterga
    }
    const { data: order } = await supabase
      .from("orders")
      .select("shopify_order_id")
      .eq("conversation_id", conv.id)
      .gt("created_at", row.created_at)
      .limit(1)
      .maybeSingle();
    if (order) {
      await terminal(row.reminder_1_sent_at ? "recovered" : "cancelled", {
        recovered_shopify_order_id: order.shopify_order_id ?? null,
        recovered_at: new Date().toISOString(),
      });
      return "expired";
    }
  }

  // 7) El botón debe reconstruir un link válido sobre la base fija de la
  // plantilla (sufijo directo o token del checkout — ver buttonSuffix).
  const base = settings.checkout_url_base;
  const url = row.abandoned_checkout_url ?? "";
  const urlSuffix = buttonSuffix(url, base);
  if (!urlSuffix) {
    await terminal("expired");
    await logEvent({
      kind: "cart_reminder",
      severity: "warning",
      tenantId: tenant.id,
      detail: { stage: "url_mismatch", checkout_id: row.id, url: url.slice(0, 120), base },
    });
    return "expired";
  }

  // Variables de la plantilla (server-side, jamás el modelo).
  const firstName = row.customer_name?.trim().split(/\s+/)[0] || "de nuevo";
  const productDesc = describeItems(row.line_items);
  const templateName = phase === 1 ? settings.template_1 : settings.template_2;
  const bodyParams = (
    phase === 1
      ? [firstName, productDesc]
      : [firstName, productDesc, formatCop(row.total_price ?? 0)]
  ).map(cleanParam);

  // 8) Envío. Fallo → 1 reintento en la corrida siguiente, luego expired.
  let waMessageId: string | null = null;
  try {
    waMessageId = await sendTemplate(wa, row.phone, {
      name: templateName,
      language: settings.template_language,
      bodyParams,
      buttonUrlParam: urlSuffix,
    });
  } catch (e) {
    const attempts = (row.send_attempts ?? 0) + 1;
    if (attempts >= 2) {
      await terminal("expired", { send_attempts: attempts });
      await logEvent({
        kind: "cart_reminder",
        severity: "error",
        tenantId: tenant.id,
        detail: { stage: "send_failed_final", checkout_id: row.id, template: templateName, error: (e as Error).message },
      });
      return "expired";
    }
    await supabase
      .from("abandoned_checkouts")
      .update({ send_attempts: attempts, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    await logEvent({
      kind: "cart_reminder",
      severity: "warning",
      tenantId: tenant.id,
      detail: { stage: "send_failed_retry", checkout_id: row.id, template: templateName, error: (e as Error).message },
    });
    return "skipped";
  }

  // Éxito: avanzar estado (nunca hacia atrás) + reflejar el envío en la
  // conversación (el equipo lo ve en el panel y Gemini en el historial).
  await supabase
    .from("abandoned_checkouts")
    .update({
      status: phase === 1 ? "reminded_1" : "reminded_2",
      [phase === 1 ? "reminder_1_sent_at" : "reminder_2_sent_at"]: new Date().toISOString(),
      // "accepted" = Meta devolvió wamid; la entrega real llega después por el
      // webhook de statuses (delivered/failed) y se correlaciona por el wamid.
      [phase === 1 ? "reminder_1_wamid" : "reminder_2_wamid"]: waMessageId,
      [phase === 1 ? "reminder_1_delivery" : "reminder_2_delivery"]: "accepted",
      send_attempts: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  sentTodayPhones.add(row.phone);

  const conversationId = conv?.id ?? (await getOrCreateConversation(tenant.id, row.phone));
  if (conversationId) {
    try {
      await createAdminClient().from("messages").insert({
        tenant_id: tenant.id,
        conversation_id: conversationId,
        wa_message_id: waMessageId,
        sender: "bot",
        msg_type: "text",
        content: `📩 [recordatorio de carrito abandonado ${phase}/2] ${productDesc}${
          row.total_price ? ` · ${formatCop(row.total_price)}` : ""
        }`,
      });
    } catch (e) {
      console.error("[carts] no se pudo persistir el mensaje del recordatorio:", e);
    }
  }

  // Telemetría de facturación: fuente de verdad del consumo del módulo.
  await logEvent({
    kind: "wa_template_usage",
    severity: "info",
    tenantId: tenant.id,
    conversationId,
    detail: {
      source: "abandoned_cart",
      template: templateName,
      template_language: settings.template_language,
      checkout_id: row.id,
      phone: row.phone,
      reminder_number: phase,
      unit_cost_usd: CART_TEMPLATE_UNIT_COST_USD,
      wa_message_id: waMessageId, // cruzable con wa_delivery_failure
    },
  });
  return "sent";
}

// Barrido completo (lo dispara el cron cada 15 min). Devuelve conteos.
export async function runCartReminderSweep(): Promise<{
  sent: number;
  skipped: number;
  expired: number;
  offHours: boolean;
}> {
  const now = new Date();
  const hour = bogotaHour(now);
  if (hour < SEND_WINDOW.from || hour >= SEND_WINDOW.to) {
    return { sent: 0, skipped: 0, expired: 0, offHours: true };
  }

  const supabase = createAdminClient();
  let sent = 0;
  let skipped = 0;
  let expired = 0;

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, wa_phone_number_id, cart_settings")
    .eq("is_active", true)
    .eq("abandoned_carts_enabled", true)
    .eq("service_paused", false) // suspendido por pago: sin marketing saliente
    .not("wa_phone_number_id", "is", null);

  for (const t of tenants ?? []) {
    const settings = cartSettings(t as Pick<Tenant, "cart_settings">);
    if (!settings.checkout_url_base) continue; // sin base configurada no se envía

    let resolved;
    try {
      resolved = await getTenantByPhoneNumberId(t.wa_phone_number_id!);
    } catch (e) {
      console.error(`[carts] tenant ${t.id} sin resolver:`, (e as Error).message);
      continue;
    }
    if (!resolved?.secrets.wa_access_token || !resolved.tenant.wa_phone_number_id) continue;
    const wa: WaCreds = {
      phoneNumberId: resolved.tenant.wa_phone_number_id,
      accessToken: resolved.secrets.wa_access_token,
    };

    const [d1, d2] = settings.delays_minutes;
    const due1 = new Date(now.getTime() - d1 * 60_000).toISOString();
    const due2 = new Date(now.getTime() - d2 * 60_000).toISOString();
    // El recordatorio 1 cuenta desde la última actividad; el 2 desde el ENVÍO
    // del 1 (last_activity_at no sirve: cada checkouts/update de Shopify lo
    // reprograma y postergaba el 2 indefinidamente).
    const { data: rows } = await supabase
      .from("abandoned_checkouts")
      .select(
        "id, phone, customer_name, line_items, total_price, abandoned_checkout_url, status, created_at, last_activity_at, reminder_1_sent_at, send_attempts"
      )
      .eq("tenant_id", t.id)
      .or(
        `and(status.eq.pending,last_activity_at.lte.${due1}),and(status.eq.reminded_1,reminder_1_sent_at.lte.${due2})`
      )
      .order("last_activity_at", { ascending: false })
      .limit(MAX_PER_TENANT);
    const candidates = (rows ?? []) as CheckoutRow[];
    if (candidates.length === 0) continue;

    // Compradores que YA recibieron un recordatorio de carrito hoy (día Bogotá;
    // con el día UTC la regla se apagaba entre las 19:00 y 20:00 de Bogotá).
    const dayStart = bogotaDayStart(bogotaDayIso(now))!;
    const { data: sentRows } = await supabase
      .from("abandoned_checkouts")
      .select("phone")
      .eq("tenant_id", t.id)
      .or(`reminder_1_sent_at.gte.${dayStart},reminder_2_sent_at.gte.${dayStart}`);
    const sentTodayPhones = new Set((sentRows ?? []).map((r) => r.phone));

    // Con varios checkouts vencidos del mismo comprador gana el MÁS reciente
    // (la lista viene ordenada desc). Los demás expiran SOLO si el ganador
    // realmente sale ("sent"): si se posterga o falla, quedan intactos y
    // vuelven a competir en la siguiente corrida.
    const winners: CheckoutRow[] = [];
    const losersByPhone = new Map<string, CheckoutRow[]>();
    for (const row of candidates) {
      const losers = losersByPhone.get(row.phone);
      if (losers) {
        losers.push(row);
        continue;
      }
      losersByPhone.set(row.phone, []);
      winners.push(row);
    }

    for (const row of winners) {
      try {
        const result = await processCheckout({
          tenant: resolved.tenant,
          wa,
          settings,
          row,
          sentTodayPhones,
        });
        if (result === "sent") sent++;
        else if (result === "expired") expired++;
        else skipped++;
        if (result === "sent") {
          for (const loser of losersByPhone.get(row.phone) ?? []) {
            await supabase
              .from("abandoned_checkouts")
              .update({ status: "expired", updated_at: new Date().toISOString() })
              .eq("id", loser.id);
            expired++;
          }
        }
      } catch (e) {
        skipped++;
        await logEvent({
          kind: "cart_reminder",
          severity: "warning",
          tenantId: t.id,
          detail: { stage: "process_failed", checkout_id: row.id, error: (e as Error).message },
        });
      }
    }
  }

  return { sent, skipped, expired, offHours: false };
}
