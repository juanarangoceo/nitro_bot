"use client";

// Conexión Shopify vía OAuth (spec 08): guardar Client ID/Secret de la app del
// Dev Dashboard y lanzar el flujo. El token nunca se copia a mano.

import { useActionState } from "react";
import { saveShopifyAppCreds, type RotateState } from "../../actions";

const INITIAL: RotateState = { ok: false, error: null };

export function ShopifyConnect({
  tenantId,
  hasDomain,
  hasClientId,
  hasClientSecret,
  hasToken,
  banner,
}: {
  tenantId: string;
  hasDomain: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasToken: boolean;
  banner: { kind: "ok" | "error"; reason?: string } | null;
}) {
  const [state, formAction, pending] = useActionState(saveShopifyAppCreds, INITIAL);
  const canConnect = hasDomain && hasClientId && hasClientSecret;

  return (
    <div className="space-y-4">
      {banner && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            banner.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {banner.kind === "ok"
            ? "Conectado ✅ — token guardado, scopes verificados. Webhooks y catálogo se sincronizan en segundo plano (ver auditoría)."
            : `No se pudo conectar: ${banner.reason ?? "error desconocido"}`}
        </div>
      )}

      <p className="text-xs text-neutral-500">
        Estado:{" "}
        {hasToken ? (
          <span className="text-emerald-600">Conectado ✅ (token guardado)</span>
        ) : (
          <span className="text-amber-600">Sin conectar</span>
        )}
        {" · "}app: {hasClientId ? "Client ID ✅" : "Client ID ⚠️"} ·{" "}
        {hasClientSecret ? "Client Secret ✅" : "Client Secret ⚠️"}
      </p>

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="tenant_id" value={tenantId} />
        <label className="block">
          <span className="text-xs font-medium text-neutral-600">Client ID de la app</span>
          <input
            name="shopify_client_id"
            placeholder={hasClientId ? "(configurado — solo llena para cambiar)" : ""}
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-neutral-600">Client Secret de la app</span>
          <input
            name="shopify_client_secret"
            type="password"
            autoComplete="off"
            placeholder={hasClientSecret ? "(configurado — solo llena para cambiar)" : ""}
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
          />
        </label>
        {state.error && <p className="text-xs text-red-600">{state.error}</p>}
        {state.ok && <p className="text-xs text-emerald-600">Credenciales guardadas.</p>}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          {pending ? "Guardando…" : "Guardar credenciales de la app"}
        </button>
      </form>

      <div>
        {canConnect ? (
          <a
            href={`/api/shopify/oauth/start?tenant_id=${tenantId}`}
            className="inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            {hasToken ? "Reconectar Shopify" : "Conectar Shopify"}
          </a>
        ) : (
          <button
            type="button"
            disabled
            title="Faltan dominio de la tienda, Client ID o Client Secret"
            className="cursor-not-allowed rounded-lg bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-400"
          >
            Conectar Shopify
          </button>
        )}
        <p className="mt-2 text-[11px] text-neutral-400">
          Requiere una app en el Dev Dashboard de Shopify con flujo de instalación heredado,
          redirect_uri = {"{APP_BASE_URL}"}/api/shopify/oauth/callback y los scopes
          read_products, read_orders, write_orders, read_customers, write_customers.
        </p>
      </div>
    </div>
  );
}
