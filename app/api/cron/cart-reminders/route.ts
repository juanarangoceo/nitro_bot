// Cron de recordatorios de carrito abandonado (cada 15 min; la ventana
// horaria 8:00–20:00 Bogotá se aplica DENTRO del barrido). Ver
// lib/carts/reminders.ts. Igual que los demás crons: Vercel Cron (o un
// scheduler externo) lo invoca con Authorization: Bearer ${CRON_SECRET}.

import { runCartReminderSweep } from "@/lib/carts/reminders";

export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const result = await runCartReminderSweep();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron cart-reminders] falló:", (e as Error).message);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
