// Ciclo de facturación por pago (modelo 2026-07-17). Reglas:
//   1. Plan agotado + addon_enabled → factura «adicional» pendiente y el bot
//      sigue descontando del paquete de 2.000.
//   2. Factura de «renovación» al 80% del total del ciclo (plan, o plan+2.000
//      si entró el adicional) o 10 días antes del corte — una por ciclo
//      (unique index invoices_cycle_key).
//   3. Agotado el total sin pagar → el bot se pausa (palanca de cobro).
//   4. Pagar la renovación (botón en /admin) resetea el contador a 0 y corre
//      el corte a pago + 1 mes; pagar el adicional solo limpia la deuda.
// Las escrituras de facturas/alertas son best-effort: un fallo aquí jamás
// tumba la respuesta del bot. La decisión responder/pausar SÍ es firme.

import { createAdminClient } from "./supabase/admin";
import { sendTelegramAlert, escTelegram } from "./notify/telegram";
import { ADDON_MESSAGES, ADDON_PENDING_DAYS, formatCop } from "./billing";

type BillingTenant = {
  id: string;
  name: string;
  counter_period_start: string;
  monthly_fee: number | null;
  addon_price: number | null;
  addon_enabled?: boolean | null;
  billing_due_date: string | null;
  pending_plan?: Record<string, unknown> | null;
};

type Counter = { current_count: number; message_limit: number };

// Crea la factura del ciclo si no existe (idempotente por el unique index
// (tenant, concept, cycle_start)). Marca al tenant «pendiente» al crearla.
// `created` es true SOLO cuando la factura es nueva (para alertar una vez);
// si ya existía devuelve su estado y fecha (vigencia del adicional).
async function ensureInvoice(
  tenant: BillingTenant,
  concept: "renovacion" | "adicional",
  amount: number
): Promise<{ created: boolean; status: string; createdAt: string }> {
  const admin = createAdminClient();
  // Vencimiento visible en /admin y en el Plan del cliente: la renovación
  // vence en el corte del tenant (cubre el próximo ciclo); el adicional, a
  // los 15 días de generarse (la ventana que pausa el bot si sigue pendiente).
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  let dueDate: string | null = tenant.billing_due_date;
  if (concept === "adicional") {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + ADDON_PENDING_DAYS);
    dueDate = d.toISOString().slice(0, 10);
  }
  const { data: inserted, error } = await admin
    .from("invoices")
    .insert({
      tenant_id: tenant.id,
      concept,
      amount,
      cycle_start: tenant.counter_period_start,
      due_date: dueDate,
    })
    .select("status, created_at")
    .single();
  if (!error && inserted) {
    await admin.from("tenants").update({ billing_status: "pendiente" }).eq("id", tenant.id);
    return { created: true, status: inserted.status, createdAt: inserted.created_at };
  }
  // 23505 = ya existe la del ciclo (lo normal a partir del segundo mensaje).
  if (error && error.code !== "23505") {
    console.error(`[billing] no se pudo crear factura ${concept}:`, error.message);
  }
  const { data: existing } = await admin
    .from("invoices")
    .select("status, created_at")
    .eq("tenant_id", tenant.id)
    .eq("concept", concept)
    .eq("cycle_start", tenant.counter_period_start)
    .maybeSingle();
  return {
    created: false,
    status: existing?.status ?? "pendiente",
    createdAt: existing?.created_at ?? new Date().toISOString(),
  };
}

// Procesa el consumo de UN mensaje ya contado (counter viene del RPC
// increment_message_counter). Decide si el bot puede responder y genera
// facturas/alertas en los cruces. La llama el worker en cada mensaje real.
export async function processBillingOnMessage(
  tenant: BillingTenant,
  counter: Counter
): Promise<{ allowed: boolean }> {
  const planLimit = counter.message_limit;
  const count = counter.current_count;
  const addonOn = tenant.addon_enabled === true && tenant.addon_price != null;

  // Límite efectivo del ciclo: el adicional solo cuenta si está activado.
  const effectiveLimit = addonOn ? planLimit + ADDON_MESSAGES : planLimit;

  try {
    // Plan agotado con adicional activado → factura del adicional (una vez).
    // Vigencia: con la factura PENDIENTE, el adicional vence a los 15 días
    // (puente de cobro); pagada, manda solo el tope de mensajes.
    if (count > planLimit && addonOn) {
      const addonInv = await ensureInvoice(tenant, "adicional", Number(tenant.addon_price));
      if (
        addonInv.status === "pendiente" &&
        Date.now() - new Date(addonInv.createdAt).getTime() >
          ADDON_PENDING_DAYS * 24 * 60 * 60 * 1000
      ) {
        // Renovación pagada en espera → el ciclo nuevo arranca aquí mismo.
        if (await tryActivateQueuedRenewal(tenant)) return { allowed: true };
        console.warn(
          `[billing] tenant ${tenant.id}: adicional vencido (${ADDON_PENDING_DAYS} días sin pago); pausado.`
        );
        return { allowed: false };
      }
      if (addonInv.created) {
        await sendTelegramAlert(
          `🟠 <b>${escTelegram(tenant.name)}</b> agotó su plan (${planLimit.toLocaleString(
            "es-CO"
          )} msgs) y entró al paquete adicional de ${ADDON_MESSAGES.toLocaleString(
            "es-CO"
          )}. Factura pendiente: ${escTelegram(
            formatCop(Number(tenant.addon_price))
          )} (vence en ${ADDON_PENDING_DAYS} días si no se registra el pago).`
        );
      }
    }

    // Renovación por consumo: 80% del total del ciclo (una vez por ciclo; el
    // cron de 10-días-antes usa esta misma idempotencia).
    if (tenant.monthly_fee != null && count >= Math.round(effectiveLimit * 0.8)) {
      const { created } = await ensureInvoice(
        tenant,
        "renovacion",
        Number(tenant.monthly_fee)
      );
      if (created) {
        await sendTelegramAlert(
          `🟠 <b>${escTelegram(tenant.name)}</b> cruzó el 80% de su ciclo (${count.toLocaleString(
            "es-CO"
          )}/${effectiveLimit.toLocaleString(
            "es-CO"
          )} msgs): factura de renovación generada por ${escTelegram(
            formatCop(Number(tenant.monthly_fee))
          )}.`
        );
      }
    }

    // Agotado el total del ciclo: si la renovación ya está pagada (pago
    // anticipado programado), el ciclo nuevo arranca solo y el bot sigue;
    // si no, pausa (alerta solo en el cruce exacto: el contador pasa por
    // cada valor una sola vez).
    if (count > effectiveLimit) {
      if (await tryActivateQueuedRenewal(tenant)) return { allowed: true };
      if (count === effectiveLimit + 1) {
        await sendTelegramAlert(
          `🔴 <b>${escTelegram(tenant.name)}</b> agotó ${effectiveLimit.toLocaleString(
            "es-CO"
          )} mensajes${addonOn ? " (plan + adicional)" : ""}: su bot DEJÓ de responder. ` +
            `Al registrar el pago de la renovación en /admin el ciclo arranca de nuevo.`
        );
      }
      return { allowed: false };
    }
  } catch (e) {
    // Best-effort: si facturas/alertas fallan, el bot responde igual mientras
    // haya créditos (la pausa de arriba retorna antes de llegar aquí).
    console.error("[billing] processBillingOnMessage falló:", e);
  }

  return { allowed: true };
}

// Genera la factura de renovación si el corte está a ≤10 días y aún no existe
// para el ciclo actual. La llama el cron diario. Devuelve tenants facturados.
export async function generateUpcomingRenewals(): Promise<string[]> {
  const admin = createAdminClient();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const cutoff = new Date(`${today}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + 10);
  const maxDue = cutoff.toISOString().slice(0, 10);

  const { data: tenants, error } = await admin
    .from("tenants")
    .select(
      "id, name, counter_period_start, monthly_fee, addon_price, addon_enabled, billing_due_date, pending_plan"
    )
    .eq("is_active", true)
    .not("billing_due_date", "is", null)
    .not("monthly_fee", "is", null)
    .lte("billing_due_date", maxDue);
  if (error) throw new Error(`billing cron: ${error.message}`);

  const invoiced: string[] = [];
  for (const t of (tenants ?? []) as BillingTenant[]) {
    const { created } = await ensureInvoice(t, "renovacion", Number(t.monthly_fee));
    if (created) {
      invoiced.push(t.name);
      await sendTelegramAlert(
        `🟠 <b>${escTelegram(t.name)}</b>: su corte (${t.billing_due_date}) está a ≤10 días — ` +
          `factura de renovación generada por ${escTelegram(formatCop(Number(t.monthly_fee)))}.`
      );
    }
  }
  return invoiced;
}

// Recalcula billing_status: pagado solo si no queda ninguna factura pendiente
// DEL PLAN (renovación/adicional). Las manuales (0029) son cobros aparte:
// no cambian el estado del plan ni disparan el banner de factura vencida.
async function refreshBillingStatus(tenantId: string): Promise<void> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "pendiente")
    .neq("concept", "manual");
  await admin
    .from("tenants")
    .update({ billing_status: (count ?? 0) > 0 ? "pendiente" : "pagado" })
    .eq("id", tenantId);
}

// Arranca el ciclo nuevo: contador a `countStart` (1 cuando lo dispara un
// mensaje, para que ese mensaje cuente en el ciclo que empieza), corte =
// hoy(Bogotá) + 1 mes y aplica el cambio de plan programado (pending_plan).
async function activateNextCycle(tenantId: string, countStart: 0 | 1): Promise<boolean> {
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, pending_plan")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) return false;

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const next = new Date(`${today}T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);

  const update: Record<string, unknown> = {
    current_month_messages: countStart,
    counter_period_start: new Date().toISOString(),
    billing_due_date: next.toISOString().slice(0, 10),
    pending_plan: null,
  };
  const pending = (tenant.pending_plan ?? null) as {
    message_limit?: number;
    monthly_fee?: number;
    plan?: string;
  } | null;
  if (pending) {
    if (Number.isFinite(pending.message_limit)) update.message_limit = pending.message_limit;
    if (Number.isFinite(pending.monthly_fee)) update.monthly_fee = pending.monthly_fee;
    if (pending.plan) update.plan = pending.plan;
  }
  const { error } = await admin.from("tenants").update(update).eq("id", tenantId);
  if (error) {
    console.error("[billing] activateNextCycle falló:", error.message);
    return false;
  }
  await refreshBillingStatus(tenantId);
  return true;
}

// Renovación PAGADA del ciclo vigente que aún no arrancó (el pago anticipado
// queda programado: su cycle_start sigue siendo el counter_period_start
// actual — al activar, el ciclo cambia y deja de coincidir).
async function findQueuedRenewal(tenant: BillingTenant): Promise<boolean> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .eq("concept", "renovacion")
    .eq("status", "pagada")
    .eq("cycle_start", tenant.counter_period_start);
  return (count ?? 0) > 0;
}

// Si hay una renovación pagada en espera, arranca el ciclo nuevo (lo llama el
// worker justo cuando el ciclo actual se agota: el bot ni se entera).
async function tryActivateQueuedRenewal(tenant: BillingTenant): Promise<boolean> {
  if (!(await findQueuedRenewal(tenant))) return false;
  const ok = await activateNextCycle(tenant.id, 1);
  if (ok) {
    await sendTelegramAlert(
      `🟢 <b>${escTelegram(tenant.name)}</b>: se agotó su ciclo y la renovación ya estaba ` +
        `pagada — el ciclo nuevo arrancó solo (corte: hoy + 1 mes).`
    );
  }
  return ok;
}

// Marca una factura como pagada.
// Renovación: si el tenant YA agotó sus créditos (o el corte ya llegó), el
// ciclo nuevo arranca de inmediato; si aún le quedan créditos, el pago queda
// PROGRAMADO y el ciclo arranca solo al agotarlos o al llegar el corte — lo
// que ocurra primero (el cliente no pierde lo que ya pagó del adicional).
// Adicional: solo limpia la deuda.
export async function markInvoicePaid(
  invoiceId: string
): Promise<{ ok: boolean; error?: string; concept?: string; queued?: boolean }> {
  const admin = createAdminClient();

  const { data: invoice } = await admin
    .from("invoices")
    .select("id, tenant_id, concept, status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { ok: false, error: "Factura no encontrada." };
  if (invoice.status === "pagada") return { ok: false, error: "Ya está pagada." };

  const { error: payErr } = await admin
    .from("invoices")
    .update({ status: "pagada", paid_at: new Date().toISOString() })
    .eq("id", invoice.id);
  if (payErr) return { ok: false, error: payErr.message };

  let queued = false;
  if (invoice.concept === "renovacion") {
    const { data: tenant } = await admin
      .from("tenants")
      .select(
        "id, current_month_messages, message_limit, addon_enabled, addon_price, billing_due_date"
      )
      .eq("id", invoice.tenant_id)
      .maybeSingle();
    if (!tenant) return { ok: false, error: "Cliente no encontrado." };

    const addonOn = tenant.addon_enabled === true && tenant.addon_price != null;
    const effective = tenant.message_limit + (addonOn ? ADDON_MESSAGES : 0);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
    const exhausted = tenant.current_month_messages > effective;
    const corteReached = tenant.billing_due_date != null && tenant.billing_due_date <= today;

    if (exhausted || corteReached) {
      const ok = await activateNextCycle(invoice.tenant_id, 0);
      if (!ok) return { ok: false, error: "No se pudo reiniciar el ciclo." };
    } else {
      // Quedan créditos: el arranque queda programado (worker/cron lo activan).
      queued = true;
    }
  }

  await refreshBillingStatus(invoice.tenant_id);
  return { ok: true, concept: invoice.concept, queued };
}

// Cron diario: arranca el ciclo de los tenants cuyo corte YA llegó y tienen
// la renovación pagada en espera (pagaron anticipado y no agotaron créditos).
export async function activateDueRenewals(): Promise<string[]> {
  const admin = createAdminClient();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, name, counter_period_start, monthly_fee, addon_price, addon_enabled, billing_due_date, pending_plan")
    .eq("is_active", true)
    .not("billing_due_date", "is", null)
    .lte("billing_due_date", today);
  if (error) throw new Error(`billing cron (activación): ${error.message}`);

  const activated: string[] = [];
  for (const t of (tenants ?? []) as BillingTenant[]) {
    if (!(await findQueuedRenewal(t))) continue;
    if (await activateNextCycle(t.id, 0)) {
      activated.push(t.name);
      await sendTelegramAlert(
        `🟢 <b>${escTelegram(t.name)}</b>: llegó su corte con la renovación ya pagada — ` +
          `ciclo nuevo arrancado (corte: hoy + 1 mes).`
      );
    }
  }
  return activated;
}
