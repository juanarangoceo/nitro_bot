import { getPlatformAdminContext } from "@/lib/admin/context";
import { NewClientForm } from "./new-client";

export default async function NewClientPage() {
  await getPlatformAdminContext(); // gate explícito
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Alta de cliente</h1>
        <p className="text-sm text-neutral-500">
          Pega las credenciales que recolectaste y aprovisiona todo con un botón. Idempotente:
          reintentar no duplica.
        </p>
      </header>
      <NewClientForm />
    </div>
  );
}
