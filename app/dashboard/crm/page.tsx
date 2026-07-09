import { getDashboardContext } from "@/lib/dashboard/context";
import { ClearCrmButton } from "./clear-button";

export default async function CrmPage() {
  const { supabase } = await getDashboardContext();

  const { data: customers } = await supabase
    .from("customers")
    .select("name, phone, city, total_spent, first_contact")
    .order("first_contact", { ascending: false })
    .limit(500);

  const rows = customers ?? [];
  const fmtCOP = (n: number) =>
    Number(n).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">CRM</h1>
          <p className="text-sm text-neutral-500">{rows.length} clientes</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/dashboard/crm/export"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            Exportar CSV
          </a>
          <ClearCrmButton count={rows.length} />
        </div>
      </header>

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Teléfono</th>
              <th className="px-4 py-3 font-medium">Ciudad</th>
              <th className="px-4 py-3 font-medium">Total gastado</th>
              <th className="px-4 py-3 font-medium">Primer contacto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((c, i) => (
              <tr key={i} className="text-neutral-800">
                <td className="px-4 py-3">{c.name ?? "—"}</td>
                <td className="px-4 py-3">{c.phone}</td>
                <td className="px-4 py-3">{c.city ?? "—"}</td>
                <td className="px-4 py-3">{fmtCOP(c.total_spent ?? 0)}</td>
                <td className="px-4 py-3 text-neutral-500">
                  {new Date(c.first_contact).toLocaleDateString("es-CO")}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-neutral-400">
                  Aún no hay clientes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
