// Exporta el CRM del tenant como CSV. Usa el cliente SSR (RLS), así que solo
// salen los clientes del tenant del usuario autenticado. El proxy ya bloquea el
// acceso sin sesión.

import { createServerSupabase, getAuthUser } from "@/lib/supabase/server";

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Escapar comillas y envolver si hay separadores/saltos de línea.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const supabase = await createServerSupabase();
  const { data: customers, error } = await supabase
    .from("customers")
    .select("name, phone, city, total_spent, first_contact")
    .order("first_contact", { ascending: false });
  if (error) return new Response("error", { status: 500 });

  const header = ["nombre", "telefono", "ciudad", "total_gastado", "primer_contacto"];
  const lines = [header.join(",")];
  for (const c of customers ?? []) {
    lines.push(
      [c.name, c.phone, c.city, c.total_spent, c.first_contact].map(csvCell).join(",")
    );
  }
  // BOM para que Excel respete UTF-8 (acentos).
  const body = "﻿" + lines.join("\r\n");

  const date = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="crm-${date}.csv"`,
    },
  });
}
