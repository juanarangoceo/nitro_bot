// Mi cuenta: datos del usuario y cambio de contraseña.

import { getDashboardContext } from "@/lib/dashboard/context";
import { ChangePasswordForm } from "./change-password-form";

export default async function AccountPage() {
  const { user, role, tenant } = await getDashboardContext();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Mi cuenta</h1>
        <p className="text-sm text-neutral-500">Datos de acceso al panel</p>
      </header>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-500">Correo</dt>
            <dd className="text-neutral-900">{user.email}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-500">Rol</dt>
            <dd className="text-neutral-900">{role === "admin" ? "Administrador" : "Agente"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-500">Tienda</dt>
            <dd className="text-neutral-900">{tenant.name}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-neutral-900">Cambiar contraseña</h2>
        <div className="mt-4">
          <ChangePasswordForm />
        </div>
      </section>
    </div>
  );
}
