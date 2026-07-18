import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlatformAdminContext } from "@/lib/admin/context";
import {
  setTenantActive,
  updateTenantCommercial,
  updateTenantBilling,
  updateCartSettings,
} from "../../actions";
import { MarkPaidButton } from "./mark-paid-button";
import { ADDON_MESSAGES, billingInfo, formatCop, formatDueDate } from "@/lib/billing";
import { cartSettings } from "@/lib/carts/settings";
import {
  PromptEditor,
  BusinessInfoEditor,
  RotateShopify,
  RotateWa,
  ConfigureWa,
  BrandingForm,
  ResetCounterForm,
} from "./detail-forms";
import { UsersSection, type TenantUser } from "./users-section";
import { ShopifyConnect } from "./shopify-connect";

function CredFlag({ label, ok }: { label: string; ok: boolean }) {
  return (
    <li className="flex items-center justify-between text-xs">
      <span className="text-neutral-600">{label}</span>
      <span className={ok ? "text-emerald-600" : "text-amber-600"}>
        {ok ? "configurado ✅" : "falta ⚠️"}
      </span>
    </li>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ shopify_oauth?: string; reason?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { admin } = await getPlatformAdminContext();

  const oauthBanner =
    sp.shopify_oauth === "ok"
      ? ({ kind: "ok" } as const)
      : sp.shopify_oauth === "error"
        ? ({ kind: "error", reason: sp.reason } as const)
        : null;

  const { data: t } = await admin
    .from("tenants")
    .select(
      "id, name, slug, is_active, plan, monthly_fee, message_limit, current_month_messages, counter_period_start, system_prompt, business_info, shopify_domain, wa_phone_number_id, wa_display_name, wa_business_account_id, logo_url, brand_color, notification_email, reminders_enabled, voice_replies_enabled, voice_id, shipping_rules, billing_due_date, billing_status, addon_price, addon_enabled, pending_plan, test_phones, abandoned_carts_enabled, cart_settings"
    )
    .eq("id", id)
    .maybeSingle();
  if (!t) notFound();

  // Estado de credenciales: SOLO presencia (booleanos), nunca los valores. Los
  // tokens cifrados jamás llegan al navegador (regla no negociable).
  const { data: sec } = await admin
    .from("tenant_secrets")
    .select(
      "shopify_access_token, shopify_webhook_secret, wa_access_token, shopify_client_id, shopify_client_secret"
    )
    .eq("tenant_id", id)
    .maybeSingle();
  const creds = {
    shopifyToken: !!sec?.shopify_access_token,
    shopifySecret: !!sec?.shopify_webhook_secret,
    waToken: !!sec?.wa_access_token,
    wabaId: !!t.wa_business_account_id,
    phoneId: !!t.wa_phone_number_id,
    shopifyClientId: !!sec?.shopify_client_id,
    shopifyClientSecret: !!sec?.shopify_client_secret,
  };

  // Facturas del tenant (renovaciones y adicionales), las últimas primero.
  const { data: invoiceRows } = await admin
    .from("invoices")
    .select("id, concept, amount, status, cycle_start, created_at, paid_at, due_date")
    .eq("tenant_id", id)
    .order("created_at", { ascending: false })
    .limit(24);
  const invoices = invoiceRows ?? [];

  // Usuarios del dashboard del tenant + último ingreso (Auth Admin API).
  const { data: appUsers } = await admin
    .from("app_users")
    .select("id, email, name, role")
    .eq("tenant_id", id)
    .order("created_at", { ascending: true });
  const users: TenantUser[] = await Promise.all(
    (appUsers ?? []).map(async (u) => {
      const { data } = await admin.auth.admin.getUserById(u.id);
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        lastSignInAt: data?.user?.last_sign_in_at ?? null,
      };
    })
  );

  const { data: audit } = await admin
    .from("audit_log")
    .select("action, detail, created_at")
    .eq("tenant_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/admin" className="text-xs text-neutral-400 hover:underline">
          ← Clientes
        </Link>
        <header className="mt-1 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">{t.name}</h1>
            <p className="text-sm text-neutral-500">
              {t.slug} · {t.shopify_domain ?? "sin Shopify"} ·{" "}
              {t.wa_display_name ?? t.wa_phone_number_id ?? "sin WhatsApp"}
            </p>
          </div>
          <form action={setTenantActive}>
            <input type="hidden" name="tenant_id" value={t.id} />
            <input type="hidden" name="active" value={(!t.is_active).toString()} />
            <button
              type="submit"
              className={`rounded-lg px-4 py-2 text-sm font-medium ${
                t.is_active
                  ? "border border-neutral-300 text-neutral-700 hover:bg-neutral-100"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
            >
              {t.is_active ? "Pausar cliente" : "Activar cliente"}
            </button>
          </form>
        </header>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Datos del cliente">
          <form action={updateTenantCommercial} className="space-y-3">
            <input type="hidden" name="tenant_id" value={t.id} />
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Nombre (lo ve el cliente en su dashboard)
              </span>
              <input
                name="name"
                defaultValue={t.name}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Plan</span>
              <input
                name="plan"
                defaultValue={t.plan ?? ""}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Mensualidad (COP)</span>
              <input
                name="monthly_fee"
                type="number"
                defaultValue={t.monthly_fee ?? ""}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Límite de mensajes/mes</span>
              <input
                name="message_limit"
                type="number"
                defaultValue={t.message_limit ?? ""}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
              />
            </label>
            <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
              <p className="mb-1 text-xs font-medium text-neutral-600">
                El cambio de plan/mensualidad/límite se aplica…
              </p>
              <label className="mr-4 text-xs text-neutral-700">
                <input type="radio" name="plan_apply" value="now" defaultChecked /> Ahora
                (pisa el ciclo vigente)
              </label>
              <label className="text-xs text-neutral-700">
                <input type="radio" name="plan_apply" value="next_cycle" /> Al próximo ciclo
                (al pagar la renovación)
              </label>
              {t.pending_plan && (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  Cambio programado:{" "}
                  {(t.pending_plan as { plan?: string }).plan ?? "mismo plan"} ·{" "}
                  {formatCop(
                    (t.pending_plan as { monthly_fee?: number }).monthly_fee ?? t.monthly_fee
                  )}{" "}
                  ·{" "}
                  {(
                    (t.pending_plan as { message_limit?: number }).message_limit ??
                    t.message_limit
                  ).toLocaleString("es-CO")}{" "}
                  msgs — se aplica al pagar la próxima renovación.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-neutral-600">Costo de envío (COP)</span>
                <input
                  name="shipping_flat_fee"
                  type="number"
                  min={0}
                  defaultValue={Number((t.shipping_rules as { flat_fee?: number })?.flat_fee ?? 15000)}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-neutral-600">Envío GRATIS desde (COP)</span>
                <input
                  name="shipping_free_over"
                  type="number"
                  min={0}
                  defaultValue={Number((t.shipping_rules as { free_over?: number })?.free_over ?? 150000)}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
                />
              </label>
            </div>
            <p className="text-xs text-neutral-400">
              Estos valores son los que cobra la ORDEN (crear_orden) y los que el asesor cita en el chat.
            </p>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Correo de notificaciones (nueva conversación y tickets; vacío = sin avisos)
              </span>
              <input
                name="notification_email"
                type="email"
                defaultValue={t.notification_email ?? ""}
                placeholder="equipo@latienda.com"
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-600">
              <input type="hidden" name="reminders_enabled_present" value="1" />
              <input
                type="checkbox"
                name="reminders_enabled"
                defaultChecked={t.reminders_enabled !== false}
              />
              Recordatorios automáticos (follow-up a conversaciones a medias)
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-600">
              <input type="hidden" name="voice_replies_enabled_present" value="1" />
              <input
                type="checkbox"
                name="voice_replies_enabled"
                defaultChecked={t.voice_replies_enabled === true}
              />
              Respuestas de voz (premium): nota de voz cuando el cliente manda audio
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Voz de Mistral del cliente (voice_id; vacío = voz de la plataforma)
              </span>
              <input
                name="voice_id"
                defaultValue={t.voice_id ?? ""}
                placeholder="voice_..."
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Números de prueba (separados por coma): sus conversaciones NO
                descuentan mensajes y salen como «Prueba» en el dashboard
              </span>
              <input
                name="test_phones"
                defaultValue={
                  Array.isArray(t.test_phones) ? (t.test_phones as string[]).join(", ") : ""
                }
                placeholder="+573146681896"
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
              />
            </label>
            <p className="text-xs text-neutral-400">
              {(() => {
                const used = Number(t.current_month_messages ?? 0);
                const limit = Number(t.message_limit ?? 0);
                const addonOn = t.addon_enabled === true && t.addon_price != null;
                const effective = addonOn ? limit + ADDON_MESSAGES : limit;
                return (
                  <>
                    Consumo actual: {used.toLocaleString("es-CO")} /{" "}
                    {effective.toLocaleString("es-CO")}
                    {addonOn &&
                      ` (plan ${limit.toLocaleString("es-CO")} + adicional ${ADDON_MESSAGES.toLocaleString("es-CO")})`}
                    {addonOn && used > limit && used < effective && (
                      <span className="font-medium text-amber-600"> · adicional en uso 🟠</span>
                    )}
                  </>
                );
              })()}
            </p>
            <button
              type="submit"
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Guardar
            </button>
          </form>
          <ResetCounterForm
            tenantId={t.id}
            current={Number(t.current_month_messages ?? 0)}
          />
        </Card>

        <Card title="Rotar credenciales">
          <div className="space-y-4">
            <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
              <p className="mb-2 text-xs font-medium text-neutral-700">
                Estado actual (los valores cifrados nunca se muestran)
              </p>
              <ul className="space-y-1">
                <CredFlag label="Shopify · access token" ok={creds.shopifyToken} />
                <CredFlag label="Shopify · API secret (HMAC)" ok={creds.shopifySecret} />
                <CredFlag label="WhatsApp · phone_number_id" ok={creds.phoneId} />
                <CredFlag label="WhatsApp · token" ok={creds.waToken} />
                <CredFlag label="WhatsApp · WABA ID" ok={creds.wabaId} />
              </ul>
            </div>
            <RotateShopify tenantId={t.id} slug={t.slug ?? ""} name={t.name} />
            <hr className="border-neutral-100" />
            <RotateWa tenantId={t.id} slug={t.slug ?? ""} />
            <p className="text-[11px] text-neutral-400">
              Los tokens se cifran en reposo y nunca se devuelven al navegador.
            </p>
          </div>
        </Card>
      </div>

      <Card title="Plan y facturación">
        {(() => {
          const billing = billingInfo(t);
          const paid = billing.status === "pagado";
          return (
            <p className="mb-3 text-xs">
              El cliente lo ve en su módulo «Plan» (solo usuarios con rol admin).{" "}
              <span
                className={
                  paid
                    ? "font-medium text-emerald-600"
                    : billing.overdue
                      ? "font-medium text-red-600"
                      : "font-medium text-amber-600"
                }
              >
                {paid
                  ? `Al día · corte ${formatDueDate(billing.dueDate)}`
                  : `${billing.overdue ? "VENCIDA" : "Pendiente"} · ${formatCop(
                      t.monthly_fee
                    )} · corte ${formatDueDate(billing.dueDate)}`}
              </span>
            </p>
          );
        })()}
        <form action={updateTenantBilling} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="tenant_id" value={t.id} />
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Fecha de corte</span>
            <input
              name="billing_due_date"
              type="date"
              defaultValue={t.billing_due_date ?? ""}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
          </label>
          {/* El estado del pago ya NO se edita a mano: lo derivan las facturas
              (pendiente si hay alguna sin pagar; pagado si no queda ninguna). */}
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Adicional {ADDON_MESSAGES.toLocaleString("es-CO")} msgs (COP; vacío = no ofrecer)
            </span>
            <input
              name="addon_price"
              type="number"
              min={0}
              defaultValue={t.addon_price ?? ""}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
          </label>
          <div className="sm:col-span-2">
            <input type="hidden" name="addon_enabled_present" value="1" />
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                name="addon_enabled"
                defaultChecked={t.addon_enabled === true}
              />
              Adicional automático: al agotar el plan, el bot sigue con el paquete de{" "}
              {ADDON_MESSAGES.toLocaleString("es-CO")} y se genera la factura pendiente
              (apagado = el bot se pausa al agotar el plan)
            </label>
            <p className="mt-2 text-xs text-neutral-400">
              La mensualidad (COP) y el límite del plan se editan en «Datos del cliente».
              Los pagos se registran abajo en «Facturas»: pagar la renovación reinicia el
              ciclo y corre el corte a pago + 1 mes.
            </p>
            <button
              type="submit"
              className="mt-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Guardar facturación
            </button>
          </div>
        </form>

        <div className="mt-6 border-t border-neutral-100 pt-4">
          <p className="mb-2 text-xs font-medium text-neutral-700">Facturas</p>
          {invoices.length === 0 ? (
            <p className="text-xs text-neutral-400">
              Sin facturas aún. Se generan solas: renovación al 80% del ciclo o 10 días
              antes del corte; adicional al agotar el plan (si está activado).
            </p>
          ) : (
            <ul className="space-y-2">
              {invoices.map((inv) => {
                return (
                  <li
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="font-medium text-neutral-800">
                        {inv.concept === "renovacion"
                          ? `Renovación del plan${inv.status === "pendiente" ? " (próximo ciclo)" : ""}`
                          : `Adicional ${ADDON_MESSAGES.toLocaleString("es-CO")} msgs`}
                      </span>
                      <span className="ml-2 text-neutral-600">{formatCop(inv.amount)}</span>
                      <p className="text-[11px] text-neutral-400">
                        emitida {new Date(inv.created_at).toLocaleDateString("es-CO")}
                        {inv.due_date
                          ? ` · ${inv.concept === "renovacion" ? "corte" : "vence"} ${formatDueDate(inv.due_date)}`
                          : ""}
                        {inv.paid_at
                          ? ` · pagada el ${new Date(inv.paid_at).toLocaleDateString("es-CO")}`
                          : ""}
                      </p>
                    </div>
                    {inv.status === "pagada" ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        {inv.concept === "renovacion" &&
                        inv.cycle_start === t.counter_period_start
                          ? "Pagada · el ciclo nuevo arranca al agotar créditos o en el corte"
                          : "Pagada"}
                      </span>
                    ) : (
                      <MarkPaidButton
                        invoiceId={inv.id}
                        tenantId={t.id}
                        concept={inv.concept}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-neutral-400">
            «Marcar pagada» en una renovación: contador a 0, corte = hoy + 1 mes y aplica
            el cambio de plan programado si lo hay. En un adicional: solo registra el pago.
          </p>
        </div>
      </Card>

      <Card title="Carritos abandonados">
        {(() => {
          const cs = cartSettings(t);
          return (
            <>
              <p className="mb-3 text-xs text-neutral-500">
                Recuperación por WhatsApp con plantillas de marketing de Meta: máx 2
                recordatorios por carrito, 1 por comprador/día, ventana 8:00–20:00
                Bogotá, opt-out con «BAJA». Requiere las plantillas APROBADAS en la
                WABA del cliente y los scopes read_checkouts/read_orders en Shopify
                (re-correr el registro de webhooks al activar).
                {t.abandoned_carts_enabled && !cs.checkout_url_base && (
                  <span className="mt-1 block font-medium text-amber-600">
                    ⚠️ Falta la base de la URL del botón: el cron NO envía hasta
                    configurarla.
                  </span>
                )}
              </p>
              <form action={updateCartSettings} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="tenant_id" value={t.id} />
                <label className="flex items-center gap-2 sm:col-span-2">
                  <input
                    type="checkbox"
                    name="abandoned_carts_enabled"
                    defaultChecked={t.abandoned_carts_enabled === true}
                    className="h-4 w-4 rounded border-neutral-300"
                  />
                  <span className="text-sm text-neutral-700">
                    Módulo activo (captura checkouts y envía recordatorios)
                  </span>
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-neutral-600">
                    Base de la URL del botón (la parte FIJA de la plantilla; el sufijo
                    del checkout viaja como variable)
                  </span>
                  <input
                    name="cart_url_base"
                    defaultValue={cs.checkout_url_base}
                    placeholder="https://tienda.com/checkouts/cn/"
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-neutral-600">
                    Recordatorio 1 (minutos tras el abandono)
                  </span>
                  <input
                    name="cart_delay_1"
                    type="number"
                    min={15}
                    defaultValue={cs.delays_minutes[0]}
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-neutral-600">
                    Recordatorio 2 (minutos tras el abandono)
                  </span>
                  <input
                    name="cart_delay_2"
                    type="number"
                    min={60}
                    defaultValue={cs.delays_minutes[1]}
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-neutral-600">Plantilla 1</span>
                  <input
                    name="cart_template_1"
                    defaultValue={cs.template_1}
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-neutral-600">Plantilla 2</span>
                  <input
                    name="cart_template_2"
                    defaultValue={cs.template_2}
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-neutral-600">
                    Idioma de la plantilla (código EXACTO de Meta)
                  </span>
                  <input
                    name="cart_template_language"
                    defaultValue={cs.template_language}
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="submit"
                    className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
                  >
                    Guardar
                  </button>
                </div>
              </form>
            </>
          );
        })()}
      </Card>

      <Card title="Conexión Shopify (OAuth)">
        <ShopifyConnect
          tenantId={t.id}
          hasDomain={!!t.shopify_domain}
          hasClientId={creds.shopifyClientId}
          hasClientSecret={creds.shopifyClientSecret}
          hasToken={creds.shopifyToken}
          banner={oauthBanner}
        />
      </Card>

      <Card title="Usuarios del dashboard">
        <UsersSection tenantId={t.id} users={users} />
      </Card>

      <Card title="Personalización del dashboard">
        <BrandingForm tenantId={t.id} logoUrl={t.logo_url} brandColor={t.brand_color} />
      </Card>

      <Card title="WhatsApp: suscripción y perfil">
        <ConfigureWa tenantId={t.id} />
      </Card>

      <Card title="Prompt del asesor">
        <PromptEditor tenantId={t.id} initialPrompt={t.system_prompt ?? ""} />
      </Card>

      <Card title="Información de la empresa">
        <p className="mb-2 text-xs text-amber-600">
          OJO: el costo de envío de las órdenes sale de los campos &quot;Costo de envío&quot; en
          Datos del cliente — este texto es solo narrativo (garantías, tiempos, medios de pago).
        </p>
        <BusinessInfoEditor tenantId={t.id} initialInfo={t.business_info ?? ""} />
      </Card>

      <Card title="Auditoría reciente">
        {(audit ?? []).length === 0 ? (
          <p className="text-sm text-neutral-400">Sin eventos.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {(audit ?? []).map((a, i) => (
              <li key={i} className="flex justify-between border-b border-neutral-100 py-1">
                <span className="text-neutral-700">{a.action}</span>
                <span className="text-neutral-400">{new Date(a.created_at).toLocaleString("es-CO")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
