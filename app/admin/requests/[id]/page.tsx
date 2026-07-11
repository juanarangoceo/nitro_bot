// Detalle de una solicitud (super-admin): datos completos, hilo de
// comentarios y acciones de gestión (estado + fecha estimada + respuesta).

import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlatformAdminContext } from "@/lib/admin/context";
import {
  CATEGORY_LABELS,
  STATUS_BADGE,
  STATUS_LABELS,
  formatEta,
  type RequestCategory,
  type RequestStatus,
} from "@/lib/support/labels";
import { RequestAdminForms } from "./request-admin-forms";

export default async function AdminRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { admin } = await getPlatformAdminContext();
  const { id } = await params;

  const { data: request } = await admin
    .from("support_requests")
    .select(
      "id, tenant_id, created_by, category, subject, description, status, eta_date, rejection_note, created_at, status_changed_at, tenants(name)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!request) notFound();

  const [{ data: comments }, { data: author }] = await Promise.all([
    admin
      .from("support_request_comments")
      .select("id, author_role, body, created_at")
      .eq("request_id", id)
      .order("created_at", { ascending: true }),
    request.created_by
      ? admin.from("app_users").select("email").eq("id", request.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const tenant = request.tenants as unknown as { name: string } | null;
  const status = request.status as RequestStatus;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <Link href="/admin/requests" className="text-xs text-neutral-500 hover:underline">
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
          <Link href={`/admin/clients/${request.tenant_id}`} className="hover:underline">
            {tenant?.name ?? request.tenant_id.slice(0, 8)}
          </Link>{" "}
          · {CATEGORY_LABELS[request.category as RequestCategory] ?? request.category} · creada el{" "}
          {new Date(request.created_at).toLocaleString("es-CO")}
          {author?.email ? ` por ${author.email}` : ""}
        </p>
        <p className="text-xs text-neutral-400">
          Último cambio de estado: {new Date(request.status_changed_at).toLocaleString("es-CO")}
          {request.eta_date ? ` · Estimada: ${formatEta(request.eta_date)}` : ""}
        </p>
      </header>

      <div className="rounded-2xl border border-neutral-200 bg-white p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          Descripción del cliente
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">
          {request.description}
        </p>
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          Conversación
        </p>
        <div className="mt-3 space-y-3">
          {(comments ?? []).map((c) => {
            const isAdmin = c.author_role === "platform_admin";
            return (
              <div key={c.id} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                    isAdmin ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-800"
                  }`}
                >
                  <p className={`text-[11px] ${isAdmin ? "text-white/70" : "text-neutral-400"}`}>
                    {isAdmin ? "Plataforma" : "Cliente"} ·{" "}
                    {new Date(c.created_at).toLocaleString("es-CO")}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
                </div>
              </div>
            );
          })}
          {(comments ?? []).length === 0 && (
            <p className="py-4 text-center text-sm text-neutral-400">Aún no hay comentarios.</p>
          )}
        </div>
      </div>

      <RequestAdminForms
        requestId={request.id}
        currentStatus={status}
        currentEta={request.eta_date}
        currentRejectionNote={request.rejection_note}
      />
    </div>
  );
}
