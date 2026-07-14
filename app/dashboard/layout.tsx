import { getDashboardContext } from "@/lib/dashboard/context";
import { Sidebar, type NavItem } from "./_components/sidebar";
import { BillingAlert } from "./_components/billing-alert";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { tenant, user, role } = await getDashboardContext();
  const mod = tenant.modules ?? {};
  const isAdmin = role === "admin";

  // Navegación filtrada por los módulos activos del tenant (tenants.modules).
  // «Plan» además exige rol admin: los agentes no ven la facturación.
  const items: NavItem[] = [
    { href: "/dashboard", label: "Inicio" },
    ...(mod.tickets !== false ? [{ href: "/dashboard/tickets", label: "Tickets" }] : []),
    ...(mod.conversations !== false
      ? [{ href: "/dashboard/conversations", label: "Conversaciones" }]
      : []),
    ...(mod.metrics !== false ? [{ href: "/dashboard/metrics", label: "Métricas" }] : []),
    ...(mod.crm !== false ? [{ href: "/dashboard/crm", label: "CRM" }] : []),
    ...(mod.requests !== false
      ? [{ href: "/dashboard/requests", label: "Solicitudes" }]
      : []),
    ...(isAdmin && mod.plan !== false ? [{ href: "/dashboard/plan", label: "Plan" }] : []),
    { href: "/dashboard/account", label: "Mi cuenta" },
  ];

  return (
    <div
      className="flex min-h-dvh bg-neutral-50"
      style={{ "--brand": tenant.brand_color ?? "#171717" } as React.CSSProperties}
    >
      <Sidebar
        tenantName={tenant.name}
        logoUrl={tenant.logo_url}
        email={user.email ?? ""}
        items={items}
      />
      <main className="flex-1 overflow-auto p-8">
        <BillingAlert tenant={tenant} isAdmin={isAdmin} />
        {children}
      </main>
    </div>
  );
}
