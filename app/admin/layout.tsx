import { getPlatformAdminContext } from "@/lib/admin/context";
import { AdminSidebar } from "./_components/admin-sidebar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Gate explícito de super-admin (no confía en el proxy).
  const { user, admin } = await getPlatformAdminContext();

  // Solicitudes nuevas de todos los tenants → badge visible al entrar al panel.
  const { count } = await admin
    .from("support_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "nueva");

  return (
    <div className="flex min-h-dvh bg-neutral-100">
      <AdminSidebar email={user.email ?? ""} newRequests={count ?? 0} />
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
