// «Búsquedas» — demanda del canal WhatsApp: qué pide la gente en el chat.
// Lee search_log (RLS por tenant; lo escribe el asesor best-effort) y agrega
// en memoria (patrón /admin/health). El oro para el cliente es la sección de
// baja relevancia: demanda real que su catálogo no cubre.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/context";
import { bogotaDayStart, bogotaDayEnd } from "@/lib/dates";

// Umbral inicial de "el catálogo no cubre esto" (similarity coseno del mejor
// match). Calibrar con datos reales: por eso la tabla muestra el valor.
const LOW_SIMILARITY = 0.45;
const MAX_ROWS = 5000;

type SearchRow = {
  kind: string;
  query: string | null;
  product_shopify_id: string | null;
  result_count: number | null;
  top_similarity: number | null;
};

export default async function SearchesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { supabase, tenant } = await getDashboardContext();
  if (tenant.modules?.searches === false) redirect("/dashboard");

  const sp = await searchParams;
  const fromDay = sp.from && bogotaDayStart(sp.from) ? sp.from : "";
  const toDay = sp.to && bogotaDayEnd(sp.to) ? sp.to : "";
  const hasRange = Boolean(fromDay || toDay);

  // Default: últimos 30 días.
  const defaultSince = new Date();
  defaultSince.setDate(defaultSince.getDate() - 30);
  const since = fromDay ? bogotaDayStart(fromDay)! : defaultSince.toISOString();
  const until = toDay ? bogotaDayEnd(toDay)! : null;

  let query = supabase
    .from("search_log")
    .select("kind, query, product_shopify_id, result_count, top_similarity")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (until) query = query.lt("created_at", until);
  const { data } = await query;
  const rows: SearchRow[] = data ?? [];

  // Palabras más buscadas (kind=search, normalizadas).
  const byQuery = new Map<string, { label: string; count: number }>();
  // Búsquedas con baja relevancia: el catálogo probablemente no cubre esto.
  const lowByQuery = new Map<string, { label: string; count: number; best: number | null }>();
  for (const r of rows) {
    if (r.kind !== "search" || !r.query?.trim()) continue;
    const key = r.query.trim().toLowerCase();
    const prev = byQuery.get(key) ?? { label: r.query.trim(), count: 0 };
    prev.count += 1;
    byQuery.set(key, prev);

    const low =
      (r.result_count ?? 0) === 0 ||
      (r.top_similarity != null && Number(r.top_similarity) < LOW_SIMILARITY);
    if (low) {
      const p = lowByQuery.get(key) ?? { label: r.query.trim(), count: 0, best: null };
      p.count += 1;
      const sim = r.top_similarity == null ? null : Number(r.top_similarity);
      if (sim != null && (p.best == null || sim > p.best)) p.best = sim;
      lowByQuery.set(key, p);
    }
  }
  const topQueries = [...byQuery.values()].sort((a, b) => b.count - a.count).slice(0, 20);
  const lowQueries = [...lowByQuery.values()].sort((a, b) => b.count - a.count).slice(0, 20);

  // Productos más consultados (kind=detail → ficha del catálogo).
  const byProduct = new Map<string, number>();
  for (const r of rows) {
    if (r.kind !== "detail" || !r.product_shopify_id) continue;
    byProduct.set(r.product_shopify_id, (byProduct.get(r.product_shopify_id) ?? 0) + 1);
  }
  const productIds = [...byProduct.keys()];
  const titles = new Map<string, { title: string | null; image: string | null }>();
  if (productIds.length > 0) {
    const { data: prods } = await supabase
      .from("products")
      .select("shopify_id, title, image_url")
      .in("shopify_id", productIds.slice(0, 200));
    for (const p of prods ?? []) {
      titles.set(p.shopify_id, { title: p.title, image: p.image_url });
    }
  }
  const topProducts = [...byProduct.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({
      id,
      count,
      title: titles.get(id)?.title ?? id,
      image: titles.get(id)?.image ?? null,
    }));

  const totalSearches = rows.filter((r) => r.kind === "search").length;
  const rangeLabel = hasRange
    ? `${fromDay ? `desde ${fromDay}` : ""}${fromDay && toDay ? " " : ""}${toDay ? `hasta ${toDay}` : ""}`
    : "últimos 30 días";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Búsquedas</h1>
        <p className="text-sm text-neutral-500">
          Qué pide la gente en el chat de WhatsApp ({rangeLabel} · {totalSearches}{" "}
          búsquedas)
        </p>
      </header>

      <form
        method="get"
        action="/dashboard/searches"
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        <label className="text-neutral-500">
          Desde{" "}
          <input
            type="date"
            name="from"
            defaultValue={fromDay}
            className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-neutral-500">
          Hasta{" "}
          <input
            type="date"
            name="to"
            defaultValue={toDay}
            className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
        >
          Filtrar
        </button>
        {hasRange && (
          <Link
            href="/dashboard/searches"
            className="text-xs text-neutral-500 underline hover:text-neutral-900"
          >
            Limpiar
          </Link>
        )}
      </form>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-neutral-200 bg-white">
          <div className="border-b border-neutral-100 px-6 py-4">
            <h2 className="text-sm font-semibold text-neutral-900">Palabras más buscadas</h2>
          </div>
          {topQueries.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-neutral-400">
              Aún no hay búsquedas en este período.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {topQueries.map((q) => (
                <li key={q.label} className="flex items-center justify-between px-6 py-2.5">
                  <span className="truncate pr-3 text-sm text-neutral-800">{q.label}</span>
                  <span className="tabular-nums text-sm text-neutral-500">{q.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-white">
          <div className="border-b border-neutral-100 px-6 py-4">
            <h2 className="text-sm font-semibold text-neutral-900">
              Productos más consultados
            </h2>
            <p className="text-xs text-neutral-400">
              Fichas de producto que el asesor mostró a los clientes
            </p>
          </div>
          {topProducts.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-neutral-400">
              Aún no hay consultas de producto en este período.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {topProducts.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-6 py-2.5">
                  {p.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.image}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-md border border-neutral-200 object-cover"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">
                    {p.title}
                  </span>
                  <span className="tabular-nums text-sm text-neutral-500">{p.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-amber-200 bg-white">
        <div className="border-b border-amber-100 bg-amber-50 px-6 py-4">
          <h2 className="text-sm font-semibold text-amber-900">
            Búsquedas que tu catálogo no cubre bien
          </h2>
          <p className="text-xs text-amber-700">
            Consultas donde el mejor resultado fue poco relevante: demanda real que
            podrías estar dejando pasar.
          </p>
        </div>
        {lowQueries.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-neutral-400">
            Nada por aquí: el catálogo está respondiendo bien. 🎉
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-6 py-2 font-medium">Búsqueda</th>
                <th className="px-6 py-2 text-right font-medium">Veces</th>
                <th className="px-6 py-2 text-right font-medium">Relevancia</th>
              </tr>
            </thead>
            <tbody>
              {lowQueries.map((q) => (
                <tr key={q.label} className="border-t border-neutral-100">
                  <td className="px-6 py-2.5 text-neutral-800">{q.label}</td>
                  <td className="px-6 py-2.5 text-right tabular-nums text-neutral-700">
                    {q.count}
                  </td>
                  <td className="px-6 py-2.5 text-right tabular-nums text-neutral-500">
                    {q.best == null ? "sin resultados" : `${Math.round(q.best * 100)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
