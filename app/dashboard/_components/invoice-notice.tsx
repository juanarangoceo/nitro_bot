import Link from "next/link";

export type InvoiceNoticeSummary = {
  pending: number;
  overdue: number;
};

// Aviso compacto de marca en la esquina superior derecha. El rayo conserva la
// identidad de Nitro; rojo comunica deuda/vencimiento sin reutilizar el logo
// verde normal del tenant.
export function InvoiceNotice({ summary }: { summary: InvoiceNoticeSummary }) {
  if (summary.pending === 0) return null;

  const overdue = summary.overdue > 0;
  return (
    <div className="mb-5 flex justify-end">
      <Link
        href="/dashboard/plan#facturas"
        className={`group flex max-w-md items-center gap-3 rounded-2xl border px-3 py-2.5 shadow-sm transition ${
          overdue
            ? "border-red-200 bg-red-50 hover:bg-red-100"
            : "border-amber-200 bg-amber-50 hover:bg-amber-100"
        }`}
      >
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white ${
            overdue ? "bg-red-600" : "bg-amber-500"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
            <path d="M13.2 2 4.8 13.1h6.1L9.8 22l9.4-12.3h-6.3L13.2 2Z" />
          </svg>
        </span>
        <span className="min-w-0">
          <span
            className={`block text-sm font-semibold ${
              overdue ? "text-red-800" : "text-amber-800"
            }`}
          >
            {overdue
              ? `${summary.overdue} factura${summary.overdue === 1 ? "" : "s"} vencida${
                  summary.overdue === 1 ? "" : "s"
                }`
              : `${summary.pending} factura${summary.pending === 1 ? "" : "s"} pendiente${
                  summary.pending === 1 ? "" : "s"
                }`}
          </span>
          <span
            className={`block text-xs ${
              overdue ? "text-red-700" : "text-amber-700"
            }`}
          >
            Ver facturas y enviar comprobante →
          </span>
        </span>
      </Link>
    </div>
  );
}
