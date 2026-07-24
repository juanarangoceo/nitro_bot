"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions/auth";
import { TicketsUnreadBadge } from "./tickets-badge";
import { NotificationsBadge } from "./notifications-badge";

export type NavItem = { href: string; label: string };

export function Sidebar({
  tenantName,
  logoUrl,
  email,
  items,
}: {
  tenantName: string;
  logoUrl: string | null;
  email: string;
  items: NavItem[];
}) {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="flex items-center gap-3 px-5 py-5">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={`Logo de ${tenantName}`}
            className="h-10 w-10 shrink-0 rounded-lg border border-neutral-200 object-contain"
          />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900">{tenantName}</p>
          <p className="truncate text-xs text-neutral-500">{email}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {items.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center rounded-lg px-3 py-2 text-sm ${
                active
                  ? "bg-(--brand) text-white"
                  : "text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              {item.label}
              {item.href === "/dashboard/tickets" && <TicketsUnreadBadge />}
              {item.href === "/dashboard/notifications" && <NotificationsBadge />}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2 p-3">
        <Link
          href="/dashboard/legal"
          className="block px-3 text-[11px] text-neutral-400 hover:text-neutral-700 hover:underline"
        >
          Política de tratamiento de datos
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </aside>
  );
}
