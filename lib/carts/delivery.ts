// Carritos abandonados — lado de ENTREGA (webhook de statuses de Meta).
// La Cloud API acepta el envío (wamid) aunque no pueda entregar; el resultado
// real llega después como status delivered/failed. Aquí se correlaciona por
// el wamid (reminder_N_wamid, migración 0034) y se actúa según el código:
//
//   delivered → reminder_N_delivery = 'delivered' (+ delivered_at).
//   131049 (frecuencia de plantillas de marketing por usuario de Meta) →
//     reintento a 48h: la ÚNICA reversión de estado permitida en toda la
//     máquina (reminded_1→pending / reminded_2→reminded_1), solo desde aquí
//     (service_role) y con tope de 1 reintento.
//   131050 (el usuario detuvo el marketing) → opted_out + marketing_opt_out.
//   131026 (número sin WhatsApp / no entregable) → expired +
//     customers.wa_undeliverable_at (jamás reintentar marketing ahí).
//   otro código → reminder_N_delivery = 'failed', sin reintento automático.
//
// La atribución de "recovered" usa reminderDelivered(): un checkout cuyo
// único recordatorio FALLÓ cierra como cancelled (compró solo) — no se
// factura ni se cuenta como recuperación lo que Meta nunca entregó.

import { createAdminClient } from "../supabase/admin";
import { logEvent } from "../ops/events";
import { sendTelegramAlert } from "../notify/telegram";
import { bogotaDayIso, bogotaDayStart, bogotaDayEnd } from "../dates";
import type { WaStatus } from "../whatsapp/meta";

const RETRY_DELAY_MS = 48 * 3_600_000;
const ACTIVE_STATUSES = ["pending", "reminded_1", "reminded_2"];
const ALERT_FAILURE_RATE = 0.15;
const ALERT_MIN_SENT = 10; // sin muestra mínima no hay alarma

type DeliveryRow = {
  id: string;
  tenant_id: string;
  phone: string;
  status: string;
  reminder_1_wamid: string | null;
  reminder_2_wamid: string | null;
  reminder_1_delivery: string;
  reminder_2_delivery: string;
  delivery_retries: number;
};

// ¿Algún recordatorio salió y NO consta su fallo? ('accepted' cuenta: el
// callback delivered puede no haber llegado aún cuando entra la orden.)
export function reminderDelivered(row: {
  reminder_1_delivery?: string | null;
  reminder_2_delivery?: string | null;
}): boolean {
  const ok = (d?: string | null) => d === "accepted" || d === "delivered";
  return ok(row.reminder_1_delivery) || ok(row.reminder_2_delivery);
}

// Procesa un status delivered/failed. Devuelve el checkout_id si el wamid era
// de un recordatorio de carrito (para enriquecer wa_delivery_failure), o null.
export async function processCartDeliveryStatus(status: WaStatus): Promise<string | null> {
  const wamid = status.id;
  if (!wamid) return null;
  // Cada mensaje normal del bot también genera delivered: si Meta ya dice que
  // no es marketing, ni se consulta la DB.
  if (
    status.status === "delivered" &&
    status.pricing?.category &&
    status.pricing.category !== "marketing"
  ) {
    return null;
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("abandoned_checkouts")
    .select(
      "id, tenant_id, phone, status, reminder_1_wamid, reminder_2_wamid, reminder_1_delivery, reminder_2_delivery, delivery_retries"
    )
    .or(`reminder_1_wamid.eq.${wamid},reminder_2_wamid.eq.${wamid}`)
    .maybeSingle();
  const row = data as DeliveryRow | null;
  if (!row) return null;

  const n: 1 | 2 = row.reminder_1_wamid === wamid ? 1 : 2;
  const deliveryCol = n === 1 ? "reminder_1_delivery" : "reminder_2_delivery";
  const currentDelivery = n === 1 ? row.reminder_1_delivery : row.reminder_2_delivery;

  if (status.status === "delivered") {
    // Guard: nunca pisar un 'failed' (orden de llegada no garantizado).
    if (currentDelivery === "accepted") {
      const ts = status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date();
      await supabase
        .from("abandoned_checkouts")
        .update({
          [deliveryCol]: "delivered",
          [n === 1 ? "reminder_1_delivered_at" : "reminder_2_delivered_at"]: ts.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
    return row.id;
  }

  // failed
  const code = status.errors?.[0]?.code ?? null;
  const active = ACTIVE_STATUSES.includes(row.status);
  const base = { [deliveryCol]: "failed", updated_at: new Date().toISOString() };

  if (code === 131049 && active) {
    // Límite de frecuencia de marketing de Meta: transitorio → 1 reintento a
    // 48h. Se conservan sent_at/wamid como auditoría (el reenvío los pisa).
    if (row.delivery_retries >= 1) {
      await supabase
        .from("abandoned_checkouts")
        .update({ ...base, status: "expired" })
        .eq("id", row.id);
    } else {
      await supabase
        .from("abandoned_checkouts")
        .update({
          ...base,
          status: n === 1 ? "pending" : "reminded_1",
          next_retry_at: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
          delivery_retries: row.delivery_retries + 1,
        })
        .eq("id", row.id);
    }
  } else if (code === 131050 && active) {
    // El usuario pidió no recibir marketing desde WhatsApp.
    await supabase
      .from("abandoned_checkouts")
      .update({ ...base, status: "opted_out" })
      .eq("id", row.id);
    await supabase
      .from("customers")
      .update({ marketing_opt_out: true })
      .eq("tenant_id", row.tenant_id)
      .eq("phone", row.phone);
  } else if (code === 131026) {
    if (active) {
      await supabase
        .from("abandoned_checkouts")
        .update({ ...base, status: "expired" })
        .eq("id", row.id);
    } else {
      await supabase.from("abandoned_checkouts").update(base).eq("id", row.id);
    }
    await supabase
      .from("customers")
      .update({ wa_undeliverable_at: new Date().toISOString() })
      .eq("tenant_id", row.tenant_id)
      .eq("phone", row.phone);
  } else {
    // Código desconocido (o checkout ya cerrado): solo consta el fallo — la
    // atribución de recovered y el panel lo usan.
    await supabase.from("abandoned_checkouts").update(base).eq("id", row.id);
  }
  return row.id;
}

// Alerta diaria (cron /api/cron/billing): tasa de NO entrega del día Bogotá
// ANTERIOR por tenant con el módulo activo. Los failed llegan async (minutos
// u horas tras el barrido): por eso se mide el día cerrado, no el corriente.
export async function checkCartDeliveryAlerts(): Promise<number> {
  const supabase = createAdminClient();
  let alerts = 0;

  const yesterdayIso = bogotaDayIso(new Date(Date.now() - 24 * 3_600_000));
  const dayStart = bogotaDayStart(yesterdayIso)!;
  const dayEnd = bogotaDayEnd(yesterdayIso)!;

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("is_active", true)
    .eq("abandoned_carts_enabled", true);

  for (const t of tenants ?? []) {
    const { data: rows } = await supabase
      .from("abandoned_checkouts")
      .select("reminder_1_sent_at, reminder_2_sent_at, reminder_1_delivery, reminder_2_delivery, total_price")
      .eq("tenant_id", t.id)
      .or(
        `and(reminder_1_sent_at.gte.${dayStart},reminder_1_sent_at.lt.${dayEnd}),and(reminder_2_sent_at.gte.${dayStart},reminder_2_sent_at.lt.${dayEnd})`
      );

    let sent = 0;
    let failed = 0;
    for (const r of rows ?? []) {
      const inDay = (ts: string | null) => !!ts && ts >= dayStart && ts < dayEnd;
      if (inDay(r.reminder_1_sent_at)) {
        sent++;
        if (r.reminder_1_delivery === "failed") failed++;
      }
      if (inDay(r.reminder_2_sent_at)) {
        sent++;
        if (r.reminder_2_delivery === "failed") failed++;
      }
    }

    if (sent >= ALERT_MIN_SENT && failed / sent > ALERT_FAILURE_RATE) {
      alerts++;
      await sendTelegramAlert(
        `🟠 <b>Carritos: entrega baja</b>\n${t.name}: ayer fallaron ${failed} de ${sent} plantillas (${Math.round(
          (failed / sent) * 100
        )}%). Revisa wa_delivery_failure en /admin/health y el quality rating del número.`
      );
      await logEvent({
        kind: "cart_reminder",
        severity: "warning",
        tenantId: t.id,
        detail: { stage: "delivery_rate_alert", day: yesterdayIso, sent, failed },
      });
    }
  }
  return alerts;
}
