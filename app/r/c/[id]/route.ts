// Redirect público del botón de la plantilla de carrito abandonado
// (link_mode "redirect": la plantilla v2 apunta a APP_BASE_URL/r/c/{id}).
// 302 a la URL REAL de recuperación de Shopify (ac/…/recover?key=…), que abre
// el checkout PRELLENADO con los datos del cliente — el formato cn/{token}
// solo restaura los productos. De paso mide los CLICKS reales (primer dato de
// conversión del módulo). El id es el uuid del checkout: no adivinable, sin
// auth. JAMÁS responde 500: el link vive en chats de clientes.

import { createAdminClient } from "@/lib/supabase/admin";
import { cartSettings } from "@/lib/carts/settings";
import { logEvent } from "@/lib/ops/events";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// El id se EXTRAE del segmento en vez de exigir que sea exactamente el uuid:
// si la URL del botón de la plantilla quedó con el marcador de variable
// escrito a mano, Meta lo deja como texto literal escapado y antepone basura
// al id real (…/r/c/%7B%7B1%7D%7D<uuid>). Un carrito no puede perderse por un
// prefijo espurio: el uuid sigue siendo lo único que identifica al checkout.
function extractId(raw: string): string | null {
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    // secuencia % inválida: se busca sobre el original
  }
  return UUID_RE.exec(s)?.[0] ?? null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id: raw } = await ctx.params;
    const id = extractId(raw);
    if (!id) return new Response("No encontrado", { status: 404 });

    const supabase = createAdminClient();
    const { data: row } = await supabase
      .from("abandoned_checkouts")
      .select("id, tenant_id, checkout_token, abandoned_checkout_url, clicked_at, click_count, status")
      .eq("id", id)
      .maybeSingle();
    if (!row) return new Response("No encontrado", { status: 404 });

    // Destino: la URL cruda del webhook (prellena) o, si no llegó, el formato
    // cn/{token} sobre la base configurada (restaura solo los productos).
    let destination = row.abandoned_checkout_url ?? "";
    if (!destination) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("cart_settings")
        .eq("id", row.tenant_id)
        .maybeSingle();
      const base = tenant ? cartSettings(tenant).checkout_url_base : "";
      if (base && row.checkout_token) destination = `${base}${row.checkout_token}`;
    }
    if (!destination) return new Response("No encontrado", { status: 404 });

    // Telemetría best-effort: el redirect sale aunque esto falle.
    try {
      await supabase
        .from("abandoned_checkouts")
        .update({
          clicked_at: row.clicked_at ?? new Date().toISOString(),
          click_count: (row.click_count ?? 0) + 1,
        })
        .eq("id", row.id);
      await logEvent({
        kind: "cart_click",
        severity: "info",
        tenantId: row.tenant_id,
        detail: { checkout_id: row.id, status: row.status },
      });
    } catch (e) {
      console.error("[carts] no se pudo registrar el click:", e);
    }

    return Response.redirect(destination, 302);
  } catch (e) {
    console.error("[carts] redirect falló:", e);
    return new Response("No encontrado", { status: 404 });
  }
}
