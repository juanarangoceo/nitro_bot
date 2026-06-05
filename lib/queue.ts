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

// Encola trabajo de fondo. El error se captura aquí: una tarea que falla no debe
// tumbar el proceso ni afectar la respuesta ya enviada.
export function enqueue(task: () => Promise<void>): void {
  after(async () => {
    try {
      await task();
    } catch (e) {
      console.error("[queue] tarea de fondo falló:", e);
    }
  });
}
