import { requirePlatformAdmin } from "@/lib/admin/context";
import { getPaymentSettings } from "@/lib/platform/payment-settings";
import { PaymentSettingsForm } from "./payment-settings-form";

export default async function PaymentSettingsPage() {
  await requirePlatformAdmin();
  const settings = await getPaymentSettings();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Datos de pago</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Cuentas que ven los administradores de clientes en “Plan y pagos”.
          Este cambio aplica globalmente a todos los tenants.
        </p>
      </header>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        <PaymentSettingsForm settings={settings} />
      </section>
    </div>
  );
}
