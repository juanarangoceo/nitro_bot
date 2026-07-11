import Link from "next/link";
import { getDashboardContext } from "@/lib/dashboard/context";
import { NewRequestForm } from "./new-request-form";

export default async function NewRequestPage() {
  await getDashboardContext(); // gate de sesión + tenant

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <Link href="/dashboard/requests" className="text-xs text-neutral-500 hover:underline">
          ← Solicitudes
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-neutral-900">Nueva solicitud</h1>
        <p className="text-sm text-neutral-500">
          Cuéntanos qué necesitas: un ajuste del comportamiento del asesor, un
          error que viste o una idea para mejorar. La revisamos y te avisamos
          por correo cuando haya novedades.
        </p>
      </header>

      <div className="rounded-2xl border border-neutral-200 bg-white p-6">
        <NewRequestForm />
      </div>
    </div>
  );
}
