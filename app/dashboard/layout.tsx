import { getDashboardContext } from "@/lib/dashboard/context";
import { Sidebar, type NavItem } from "./_components/sidebar";
import { BillingAlert } from "./_components/billing-alert";
import {
  InvoiceNotice,
  type InvoiceNoticeSummary,
} from "./_components/invoice-notice";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { tenant, user, role, supabase } = await getDashboardContext();
  const mod = tenant.modules ?? {};
  const isAdmin = role === "admin";
  let invoiceSummary: InvoiceNoticeSummary = { pending: 0, overdue: 0 };
  if (isAdmin && mod.plan !== false) {
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Bogota",
    });
    const [pending, overdue] = await Promise.all([
      supabase
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendiente"),
      supabase
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendiente")
        .lt("due_date", today),
    ]);
    invoiceSummary = {
      pending: pending.count ?? 0,
      overdue: overdue.count ?? 0,
    };
  }

  // Navegación filtrada por los módulos activos del tenant (tenants.modules).
  // «Plan» además exige rol admin: los agentes no ven la facturación.
  const items: NavItem[] = [
    { href: "/dashboard", label: "Inicio" },
    ...(mod.tickets !== false ? [{ href: "/dashboard/tickets", label: "Tickets" }] : []),
    ...(mod.conversations !== false
      ? [{ href: "/dashboard/conversations", label: "Conversaciones" }]
      : []),
    ...(mod.metrics !== false ? [{ href: "/dashboard/metrics", label: "Métricas" }] : []),
    ...(mod.searches !== false
      ? [{ href: "/dashboard/searches", label: "Búsquedas" }]
      : []),
    // «Carritos» solo aparece para tenants con el módulo contratado.
    ...(tenant.abandoned_carts_enabled && mod.carts !== false
      ? [{ href: "/dashboard/carts", label: "Carritos" }]
      : []),
    ...(mod.crm !== false ? [{ href: "/dashboard/crm", label: "CRM" }] : []),
    ...(mod.requests !== false
      ? [{ href: "/dashboard/requests", label: "Solicitudes" }]
      : []),
    ...(isAdmin && mod.labels !== false
      ? [{ href: "/dashboard/labels", label: "Etiquetas" }]
      : []),
    ...(isAdmin && mod.blocklist !== false
      ? [{ href: "/dashboard/blocklist", label: "Bloqueados" }]
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
        <InvoiceNotice summary={invoiceSummary} />
        <BillingAlert tenant={tenant} isAdmin={isAdmin} />
        {children}
      </main>
    </div>
  );
}
