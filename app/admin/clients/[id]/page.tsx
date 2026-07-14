import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlatformAdminContext } from "@/lib/admin/context";
import { setTenantActive, updateTenantCommercial, updateTenantBilling } from "../../actions";
import { ADDON_MESSAGES, billingInfo, formatCop, formatDueDate } from "@/lib/billing";
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
      "id, name, slug, is_active, plan, monthly_fee, message_limit, current_month_messages, system_prompt, business_info, shopify_domain, wa_phone_number_id, wa_display_name, wa_business_account_id, logo_url, brand_color, notification_email, reminders_enabled, voice_replies_enabled, voice_id, shipping_rules, billing_due_date, billing_status, addon_price"
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

  // Usuarios del dashboard del tenant + último ingreso (Auth Admin API).
  const { data: appUsers } = await admin
    .from("app_users")
    .select("id, email, role")
    .eq("tenant_id", id)
    .order("created_at", { ascending: true });
  const users: TenantUser[] = await Promise.all(
    (appUsers ?? []).map(async (u) => {
      const { data } = await admin.auth.admin.getUserById(u.id);
      return {
        id: u.id,
        email: u.email,
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
            <p className="text-xs text-neutral-400">
              Consumo actual: {Number(t.current_month_messages ?? 0).toLocaleString("es-CO")} /{" "}
              {Number(t.message_limit ?? 0).toLocaleString("es-CO")}
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
        <form action={updateTenantBilling} className="grid gap-3 sm:grid-cols-3">
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
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Estado del pago</span>
            <select
              name="billing_status"
              defaultValue={t.billing_status ?? "pagado"}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            >
              <option value="pagado">Pagado</option>
              <option value="pendiente">Pendiente</option>
            </select>
          </label>
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
          <div className="sm:col-span-3">
            <p className="text-xs text-neutral-400">
              La mensualidad (COP) y el límite de mensajes del plan se editan en «Datos del
              cliente». Al registrar un pago: marca «Pagado» y mueve la fecha de corte al
              siguiente periodo; si vendes un paquete adicional, súmalo al límite de mensajes.
            </p>
            <button
              type="submit"
              className="mt-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Guardar facturación
            </button>
          </div>
        </form>
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
