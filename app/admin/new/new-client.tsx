"use client";

import { useActionState } from "react";
import { provisionTenantAction, type ProvisionState } from "../actions";

const init: ProvisionState = { ran: false, ok: false, steps: [], error: null };

function Field({
  label,
  name,
  type = "text",
  required = false,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-neutral-600">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-2xl border border-neutral-200 bg-white p-5">
      <legend className="px-1 text-sm font-semibold text-neutral-900">{title}</legend>
      <div className="mt-3 grid gap-3 md:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function NewClientForm() {
  const [state, action, pending] = useActionState(provisionTenantAction, init);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <form action={action} className="space-y-4">
        <Section title="Identidad y plan">
          <Field label="Nombre de la tienda" name="name" required placeholder="Elegance Colombia" />
          <Field label="Slug (único)" name="slug" required placeholder="elegance" />
          <Field label="Plan" name="plan" placeholder="estándar" />
          <Field label="Mensualidad (COP)" name="monthly_fee" type="number" placeholder="450000" />
          <Field label="Límite de mensajes/mes" name="message_limit" type="number" placeholder="3000" />
        </Section>

        <Section title="Shopify">
          <Field label="Dominio" name="shopify_domain" required placeholder="tienda.myshopify.com" />
          <Field label="Access token" name="shopify_access_token" required placeholder="shpat_..." />
          <Field label="API secret (HMAC)" name="shopify_api_secret" required placeholder="shpss_..." />
        </Section>

        <Section title="WhatsApp (montado en Meta por Nitro)">
          <Field label="Phone number ID" name="wa_phone_number_id" required />
          <Field label="WABA ID" name="waba_id" required />
          <Field label="Token (System User, larga duración)" name="wa_token" required placeholder="EAAG..." />
        </Section>

        <Section title="Perfil de WhatsApp (marca del cliente)">
          <Field label="Nombre para mostrar" name="display_name" placeholder="Elegance Colombia" />
          <Field label="Acerca de (about)" name="about" />
          <Field label="Dirección" name="address" />
          <Field label="Email" name="email" type="email" />
          <Field label="Sitio web" name="website" placeholder="https://..." />
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Foto de perfil</span>
            <input
              name="profile_photo"
              type="file"
              accept="image/*"
              className="mt-1 w-full text-xs text-neutral-600 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-xs"
            />
          </label>
        </Section>

        <Section title="Usuario del cliente (dashboard)">
          <Field label="Email" name="user_email" type="email" required />
          <Field label="Contraseña temporal" name="user_password" required />
        </Section>

        <details className="rounded-2xl border border-neutral-200 bg-white p-5">
          <summary className="cursor-pointer text-sm font-semibold text-neutral-900">
            Prompt del asesor (opcional)
          </summary>
          <textarea
            name="system_prompt"
            rows={5}
            placeholder="Eres el asesor virtual de..."
            className="mt-3 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
          />
        </details>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
        >
          {pending ? "Aprovisionando…" : "Dar de alta cliente (un botón)"}
        </button>
      </form>

      {/* Panel de resultados paso a paso */}
      <aside className="space-y-2">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-neutral-900">Progreso del alta</h2>
          {!state.ran && (
            <p className="mt-2 text-xs text-neutral-400">
              Completa el formulario y presiona el botón. Aquí verás cada paso.
            </p>
          )}
          {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
          {state.steps.length > 0 && (
            <ul className="mt-3 space-y-2">
              {state.steps.map((s, i) => (
                <li key={i} className="text-xs">
                  <span className={s.ok ? "text-emerald-600" : "text-red-600"}>
                    {s.ok ? "✅" : "❌"} {s.name}
                  </span>
                  {s.detail && <p className="text-neutral-400">{s.detail}</p>}
                </li>
              ))}
            </ul>
          )}
          {state.ran && !state.error && (
            <p className={`mt-3 text-sm font-medium ${state.ok ? "text-emerald-600" : "text-amber-600"}`}>
              {state.ok ? "Alta completa ✅" : "Alta con pasos pendientes — revisa y reintenta."}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
