import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlatformAdminContext } from "@/lib/admin/context";
import { setTenantActive, updateTenantCommercial } from "../../actions";
import { PromptEditor, RotateShopify, RotateWa, ConfigureWa } from "./detail-forms";
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
      "id, name, slug, is_active, plan, monthly_fee, message_limit, current_month_messages, system_prompt, shopify_domain, wa_phone_number_id, wa_display_name, wa_business_account_id"
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
        <UsersSection users={users} />
      </Card>

      <Card title="WhatsApp: suscripción y perfil">
        <ConfigureWa tenantId={t.id} />
      </Card>

      <Card title="Prompt del asesor">
        <PromptEditor tenantId={t.id} initialPrompt={t.system_prompt ?? ""} />
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
