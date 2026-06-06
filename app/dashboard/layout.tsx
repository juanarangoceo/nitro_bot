import { getDashboardContext } from "@/lib/dashboard/context";
import { Sidebar, type NavItem } from "./_components/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { tenant, user } = await getDashboardContext();
  const mod = tenant.modules ?? {};

  // Navegación filtrada por los módulos activos del tenant (tenants.modules).
  const items: NavItem[] = [
    { href: "/dashboard", label: "Inicio" },
    ...(mod.tickets !== false ? [{ href: "/dashboard/tickets", label: "Tickets" }] : []),
    ...(mod.conversations !== false
      ? [{ href: "/dashboard/conversations", label: "Conversaciones" }]
      : []),
    ...(mod.metrics !== false ? [{ href: "/dashboard/metrics", label: "Métricas" }] : []),
    ...(mod.crm !== false ? [{ href: "/dashboard/crm", label: "CRM" }] : []),
  ];

  return (
    <div className="flex min-h-dvh bg-neutral-50">
      <Sidebar tenantName={tenant.name} email={user.email ?? ""} items={items} />
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
