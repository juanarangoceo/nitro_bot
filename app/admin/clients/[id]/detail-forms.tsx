"use client";

import { useActionState } from "react";
import {
  updateSystemPromptAdmin,
  rotateShopifyCreds,
  rotateWaCreds,
  configureWaProfile,
  type PromptState,
  type RotateState,
  type ConfigureWaState,
} from "../../actions";

const promptInit: PromptState = { ok: false, error: null };
const rotateInit: RotateState = { ok: false, error: null };
const configInit: ConfigureWaState = { ok: false, error: null, detail: null };

export function PromptEditor({
  tenantId,
  initialPrompt,
}: {
  tenantId: string;
  initialPrompt: string;
}) {
  const [state, action, pending] = useActionState(updateSystemPromptAdmin, promptInit);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <textarea
        name="system_prompt"
        defaultValue={initialPrompt}
        rows={10}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
        >
          {pending ? "Guardando…" : "Guardar prompt"}
        </button>
        {state.ok && <span className="text-sm text-emerald-600">Guardado ✅</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

export function RotateShopify({ tenantId, slug, name }: { tenantId: string; slug: string; name: string }) {
  const [state, action, pending] = useActionState(rotateShopifyCreds, rotateInit);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="name" value={name} />
      <input
        name="shopify_domain"
        placeholder="tienda.myshopify.com"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />
      <input
        name="shopify_access_token"
        placeholder="shpat_… (nuevo)"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />
      <input
        name="shopify_api_secret"
        placeholder="shpss_… (nuevo)"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
        >
          {pending ? "Rotando…" : "Rotar Shopify"}
        </button>
        {state.ok && <span className="text-xs text-emerald-600">Rotado ✅</span>}
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

export function ConfigureWa({ tenantId }: { tenantId: string }) {
  const [state, action, pending] = useActionState(configureWaProfile, configInit);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <p className="text-xs text-neutral-500">
        Suscribe la WABA al webhook (para recibir mensajes) y configura el perfil del número.
        Usa el phone_number_id, WABA y token ya guardados.
      </p>
      <input
        name="display_name"
        placeholder="Nombre para mostrar (referencia)"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />
      <input
        name="about"
        placeholder="Acerca de (about)"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />
      <input
        name="address"
        placeholder="Dirección"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />
      <div className="flex gap-2">
        <input
          name="email"
          type="email"
          placeholder="Email"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        />
        <input
          name="website"
          placeholder="https://…"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        />
      </div>
      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Foto de perfil (opcional)</span>
        <input
          name="profile_photo"
          type="file"
          accept="image/*"
          className="mt-1 w-full text-xs text-neutral-600 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-xs"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
        >
          {pending ? "Aplicando…" : "Suscribir WABA y configurar perfil"}
        </button>
        {state.ok && <span className="text-xs text-emerald-600">{state.detail ?? "Listo ✅"}</span>}
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

export function RotateWa({ tenantId, slug }: { tenantId: string; slug: string }) {
  const [state, action, pending] = useActionState(rotateWaCreds, rotateInit);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input
        name="wa_phone_number_id"
        placeholder="phone_number_id"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />
      <input
        name="waba_id"
        placeholder="waba_id (opcional)"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />
      <input
        name="wa_token"
        placeholder="EAAG… (nuevo token)"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
        >
          {pending ? "Rotando…" : "Rotar WhatsApp"}
        </button>
        {state.ok && <span className="text-xs text-emerald-600">Rotado ✅</span>}
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
