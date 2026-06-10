// Probador del asesor: chatea con la IA de cualquier tenant sin WhatsApp,
// sin contador y sin órdenes/tickets reales (testMode).

import { getPlatformAdminContext } from "@/lib/admin/context";
import { loadTesterMessages } from "./actions";
import { TesterChat } from "./tester-chat";

export default async function TesterPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { admin } = await getPlatformAdminContext();
  const sp = await searchParams;

  const { data: tenants } = await admin
    .from("tenants")
    .select("id, name, slug")
    .order("name");
  const list = tenants ?? [];
  const selected = list.find((t) => t.id === sp.tenant) ?? list[0] ?? null;
  const initialMessages = selected ? await loadTesterMessages(selected.id) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Probador del asesor</h1>
          <p className="text-sm text-neutral-500">
            Conversación de prueba real (RAG y herramientas) — sin WhatsApp, sin consumo,
            órdenes simuladas.
          </p>
        </div>
        <form method="get" action="/admin/tester">
          <select
            name="tenant"
            defaultValue={selected?.id ?? ""}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            {list.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="ml-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            Cambiar
          </button>
        </form>
      </header>

      {selected ? (
        <TesterChat
          key={selected.id}
          tenantId={selected.id}
          tenantName={selected.name}
          initialMessages={initialMessages}
        />
      ) : (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-400">
          No hay clientes dados de alta.
        </p>
      )}
    </div>
  );
}
