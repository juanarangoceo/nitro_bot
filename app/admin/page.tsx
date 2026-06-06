import Link from "next/link";
import { getPlatformAdminContext } from "@/lib/admin/context";

type TenantRow = {
  id: string;
  name: string;
  slug: string | null;
  is_active: boolean;
  plan: string | null;
  monthly_fee: number | null;
  message_limit: number;
  current_month_messages: number;
  wa_display_name: string | null;
  wa_phone_number_id: string | null;
};

function ConsumptionBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const over80 = pct >= 80;
  return (
    <div className="w-40">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div
          className={`h-full ${over80 ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-neutral-500">
        {used.toLocaleString("es-CO")} / {limit.toLocaleString("es-CO")} ({pct}%)
      </p>
    </div>
  );
}

export default async function AdminClientsPage() {
  const { admin } = await getPlatformAdminContext();
  const { data } = await admin
    .from("tenants")
    .select(
      "id, name, slug, is_active, plan, monthly_fee, message_limit, current_month_messages, wa_display_name, wa_phone_number_id"
    )
    .order("created_at", { ascending: true });
  const tenants = (data as TenantRow[]) ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Clientes</h1>
          <p className="text-sm text-neutral-500">{tenants.length} tienda(s) en la plataforma</p>
        </div>
        <Link
          href="/admin/new"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          + Alta de cliente
        </Link>
      </header>

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
              <th className="px-5 py-3 font-medium">Cliente</th>
              <th className="px-5 py-3 font-medium">Estado</th>
              <th className="px-5 py-3 font-medium">Plan</th>
              <th className="px-5 py-3 font-medium">WhatsApp</th>
              <th className="px-5 py-3 font-medium">Consumo del mes</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                <td className="px-5 py-3">
                  <Link href={`/admin/clients/${t.id}`} className="font-medium text-neutral-900 hover:underline">
                    {t.name}
                  </Link>
                  <p className="text-[11px] text-neutral-400">{t.slug}</p>
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      t.is_active ? "bg-emerald-100 text-emerald-700" : "bg-neutral-200 text-neutral-600"
                    }`}
                  >
                    {t.is_active ? "Activo" : "Pausado"}
                  </span>
                </td>
                <td className="px-5 py-3 text-neutral-700">{t.plan ?? "—"}</td>
                <td className="px-5 py-3 text-neutral-700">
                  {t.wa_display_name ?? t.wa_phone_number_id ?? "—"}
                </td>
                <td className="px-5 py-3">
                  <ConsumptionBar used={t.current_month_messages} limit={t.message_limit} />
                </td>
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-neutral-400">
                  No hay clientes todavía. Empieza con “Alta de cliente”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
