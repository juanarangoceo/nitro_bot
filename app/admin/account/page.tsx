// Mi cuenta del super-admin: cambio de contraseña del panel de plataforma.
// Reusa el form del dashboard (la action re-autentica contra Supabase Auth
// con la contraseña actual; funciona igual para cualquier usuario de Auth).

import { requirePlatformAdmin } from "@/lib/admin/context";
import { ChangePasswordForm } from "@/app/dashboard/account/change-password-form";

export default async function AdminAccountPage() {
  const { user } = await requirePlatformAdmin();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Mi cuenta</h1>
        <p className="text-sm text-neutral-500">Acceso al panel de plataforma</p>
      </header>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-500">Correo</dt>
            <dd className="text-neutral-900">{user.email}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-500">Rol</dt>
            <dd className="text-neutral-900">Super-admin de plataforma</dd>
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
