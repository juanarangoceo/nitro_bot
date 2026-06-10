// Detalle de una conversación visto desde la plataforma (super-admin,
// service_role). Solo lectura del historial + acciones de operación (borrar
// conversaciones de prueba). Para atención al cliente final está el dashboard
// del tenant; esto es para diagnóstico y limpieza.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlatformAdminContext } from "@/lib/admin/context";
import { DeleteConversation } from "./delete-conversation";

export default async function AdminConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { admin } = await getPlatformAdminContext();

  const { data: conv } = await admin
    .from("conversations")
    .select("id, tenant_id, customer_phone, status, is_test, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!conv) notFound();

  const [{ data: tenant }, { data: messages }] = await Promise.all([
    admin.from("tenants").select("id, name").eq("id", conv.tenant_id).maybeSingle(),
    admin
      .from("messages")
      .select("id, sender, msg_type, content, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(200),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/admin/health" className="text-xs text-neutral-400 hover:underline">
          ← Salud
        </Link>
        <header className="mt-1 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">
              {conv.customer_phone}
              {conv.is_test && (
                <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700">
                  prueba
                </span>
              )}
            </h1>
            <p className="text-sm text-neutral-500">
              {tenant ? (
                <Link href={`/admin/clients/${tenant.id}`} className="hover:underline">
                  {tenant.name}
                </Link>
              ) : (
                "—"
              )}{" "}
              · estado: {conv.status} · creada{" "}
              {new Date(conv.created_at).toLocaleString("es-CO")}
            </p>
          </div>
          <DeleteConversation conversationId={conv.id} isTest={conv.is_test ?? false} />
        </header>
      </div>

      <section className="space-y-2 rounded-2xl border border-neutral-200 bg-white p-4">
        {(messages ?? []).length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-400">Sin mensajes.</p>
        ) : (
          (messages ?? []).map((m) => (
            <div
              key={m.id}
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                m.sender === "customer"
                  ? "bg-neutral-100 text-neutral-800"
                  : "ml-auto bg-neutral-900 text-white"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              <span className="mt-1 block text-[10px] opacity-60">
                {m.sender} · {new Date(m.created_at).toLocaleString("es-CO")}
              </span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
