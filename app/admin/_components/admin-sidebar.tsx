"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions/auth";

const ITEMS = [
  { href: "/admin", label: "Clientes" },
  { href: "/admin/new", label: "Alta de cliente" },
  { href: "/admin/requests", label: "Solicitudes" },
  { href: "/admin/notifications", label: "Notificaciones" },
  { href: "/admin/summary", label: "Resumen plataforma" },
  { href: "/admin/health", label: "Salud" },
  { href: "/admin/tester", label: "Probador" },
  { href: "/admin/settings/payments", label: "Datos de pago" },
  { href: "/admin/account", label: "Mi cuenta" },
];

export function AdminSidebar({
  email,
  newRequests = 0,
}: {
  email: string;
  newRequests?: number;
}) {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950 text-neutral-100">
      <div className="px-5 py-5">
        <p className="text-sm font-semibold">Nitro · Plataforma</p>
        <p className="truncate text-xs text-neutral-400">{email}</p>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {ITEMS.map((item) => {
          const active =
            item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                active ? "bg-white text-neutral-900" : "text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              {item.label}
              {item.href === "/admin/requests" && newRequests > 0 && (
                <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-semibold text-neutral-900">
                  {newRequests}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <form action={signOut} className="p-3">
        <button
          type="submit"
          className="w-full rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
        >
          Cerrar sesión
        </button>
      </form>
    </aside>
  );
}
