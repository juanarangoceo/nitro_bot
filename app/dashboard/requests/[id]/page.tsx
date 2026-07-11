import Link from "next/link";
import { notFound } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/context";
import {
  CATEGORY_LABELS,
  STATUS_BADGE,
  STATUS_LABELS,
  formatEta,
  type RequestCategory,
  type RequestStatus,
} from "@/lib/support/labels";
import { RequestThread } from "./request-thread";

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase } = await getDashboardContext();
  const { id } = await params;

  // RLS: si la solicitud no es del tenant, no aparece → 404.
  const { data: request } = await supabase
    .from("support_requests")
    .select("id, category, subject, description, status, eta_date, rejection_note, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!request) notFound();

  const { data: comments } = await supabase
    .from("support_request_comments")
    .select("id, author_role, body, created_at")
    .eq("request_id", id)
    .order("created_at", { ascending: true });

  const status = request.status as RequestStatus;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <Link href="/dashboard/requests" className="text-xs text-neutral-500 hover:underline">
          ← Solicitudes
        </Link>
        <div className="mt-1 flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold text-neutral-900">{request.subject}</h1>
          <span
            className={`mt-1 shrink-0 rounded-full px-3 py-1 text-sm font-medium ${
              STATUS_BADGE[status] ?? "bg-neutral-100 text-neutral-600"
            }`}
          >
            {STATUS_LABELS[status] ?? request.status}
          </span>
        </div>
        <p className="text-sm text-neutral-500">
          {CATEGORY_LABELS[request.category as RequestCategory] ?? request.category} · creada el{" "}
          {new Date(request.created_at).toLocaleDateString("es-CO")}
        </p>
        {request.eta_date && (
          <p className="mt-1 text-sm text-neutral-600">
            Implementación estimada: <strong>{formatEta(request.eta_date)}</strong>{" "}
            <span className="text-neutral-400">(puede ajustarse)</span>
          </p>
        )}
      </header>

      <div className="rounded-2xl border border-neutral-200 bg-white p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          Tu solicitud
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">
          {request.description}
        </p>
      </div>

      {status === "rechazada" && request.rejection_note && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
          <p className="text-sm font-medium text-red-700">
            Por ahora no vamos a avanzar con esta solicitud
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-red-700/90">
            {request.rejection_note}
          </p>
          <p className="mt-2 text-xs text-red-600/80">
            Si quieres conversarlo, déjanos un comentario aquí abajo.
          </p>
        </div>
      )}

      <RequestThread
        requestId={request.id}
        comments={comments ?? []}
        canClose={status !== "cerrada_por_cliente"}
      />
    </div>
  );
}
