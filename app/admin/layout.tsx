import { getPlatformAdminContext } from "@/lib/admin/context";
import { AdminSidebar } from "./_components/admin-sidebar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Gate explícito de super-admin (no confía en el proxy).
  const { user } = await getPlatformAdminContext();

  return (
    <div className="flex min-h-dvh bg-neutral-100">
      <AdminSidebar email={user.email ?? ""} />
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
