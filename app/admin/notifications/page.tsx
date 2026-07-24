import { getPlatformAdminContext } from "@/lib/admin/context";
import { NotificationForm } from "./notification-form";
import { archiveClientNotification } from "./actions";

const TONE_LABEL: Record<string, string> = {
  info: "Información",
  warning: "Importante",
  urgent: "Urgente",
};

export default async function AdminNotificationsPage() {
  const { admin } = await getPlatformAdminContext();
  const [{ data: tenants }, { data: notifications }] = await Promise.all([
    admin.from("tenants").select("id, name").order("name"),
    admin
      .from("client_notifications")
      .select("id, tenant_id, title, body, tone, is_archived, created_at, tenants(name)")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Notificaciones</h1>
        <p className="text-sm text-neutral-500">
          Publica mensajes internos para un cliente o para todos.
        </p>
      </header>
      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        <NotificationForm tenants={tenants ?? []} />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-900">Historial</h2>
        {(notifications ?? []).length === 0 ? (
          <p className="rounded-2xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-400">
            Aún no hay notificaciones.
          </p>
        ) : (
          (notifications ?? []).map((notification) => {
            const tenant = notification.tenants as unknown as { name: string } | null;
            return (
              <article
                key={notification.id}
                className={`rounded-2xl border bg-white p-5 ${
                  notification.is_archived ? "border-neutral-200 opacity-60" : "border-neutral-200"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-neutral-400">
                      {tenant?.name ?? notification.tenant_id.slice(0, 8)} ·{" "}
                      {TONE_LABEL[notification.tone] ?? notification.tone} ·{" "}
                      {new Date(notification.created_at).toLocaleString("es-CO")}
                    </p>
                    <h3 className="mt-1 font-semibold text-neutral-900">{notification.title}</h3>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-600">
                      {notification.body}
                    </p>
                  </div>
                  {notification.is_archived ? (
                    <span className="text-xs text-neutral-400">Archivada</span>
                  ) : (
                    <form action={archiveClientNotification}>
                      <input type="hidden" name="notification_id" value={notification.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100"
                      >
                        Archivar
                      </button>
                    </form>
                  )}
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
