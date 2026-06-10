// Abstracción de encolado de trabajo en segundo plano.
//
// Hoy: `after()` de Next.js — ejecuta el callback DESPUÉS de enviar la respuesta
// HTTP, sin bloquearla. Esto cumple la regla de "webhook responde 200 OK < 1s":
// el handler valida, encola y retorna; la IA se procesa aquí fuera del request.
//
// Mañana: migrar a QStash (reintentos + dead-letter) cambiando SOLO esta función;
// los handlers no se enteran. Por eso el resto del código nunca importa `after`
// directamente para trabajo de fondo: pasa por aquí.

import { after } from "next/server";
import { logEvent } from "./ops/events";

// Encola trabajo de fondo. El error se captura aquí: una tarea que falla no debe
// tumbar el proceso ni afectar la respuesta ya enviada. Además del log en
// consola, el fallo queda en event_log (best-effort: si la DB también falla,
// logEvent solo loguea en consola).
export function enqueue(task: () => Promise<void>): void {
  after(async () => {
    try {
      await task();
    } catch (e) {
      console.error("[queue] tarea de fondo falló:", e);
      await logEvent({
        kind: "queue_failure",
        severity: "error",
        detail: { message: (e as Error).message },
      });
    }
  });
}
