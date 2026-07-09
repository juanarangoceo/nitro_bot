// Cron horario de recordatorios (follow-up). Ver lib/ai/reminders.ts.
// Igual que reset-counters: Vercel Cron (o un scheduler externo) lo invoca con
// Authorization: Bearer ${CRON_SECRET}.

import { runReminderSweep } from "@/lib/ai/reminders";

export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const result = await runReminderSweep();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron reminders] falló:", (e as Error).message);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
