// Cron diario de facturación: genera la factura de renovación cuando la fecha
// de corte está a ≤10 días y aún no existe para el ciclo (la otra vía es el
// 80% de consumo, en el worker — misma idempotencia por unique index).
// Mismo esquema de auth que los demás crons (Bearer CRON_SECRET).

import { generateUpcomingRenewals, activateDueRenewals } from "@/lib/billing-cycle";

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const invoiced = await generateUpcomingRenewals();
    // Cortes que llegaron con la renovación pagada por anticipado → el ciclo
    // nuevo arranca hoy aunque queden créditos.
    const activated = await activateDueRenewals();
    return Response.json({ ok: true, invoiced, activated });
  } catch (e) {
    console.error("[cron billing] falló:", (e as Error).message);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
