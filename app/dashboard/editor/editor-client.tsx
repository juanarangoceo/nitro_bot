"use client";

import { useActionState } from "react";
import {
  updateSystemPrompt,
  testAssistant,
  type SaveState,
  type TestState,
} from "./actions";

const saveInit: SaveState = { ok: false, error: null };
const testInit: TestState = { reply: null, tools: [], error: null };

export function EditorClient({
  initialPrompt,
  model,
}: {
  initialPrompt: string;
  model: string;
}) {
  const [saveState, saveAction, saving] = useActionState(updateSystemPrompt, saveInit);
  const [testState, testAction, testing] = useActionState(testAssistant, testInit);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Editor del prompt */}
      <form action={saveAction} className="space-y-3">
        <label htmlFor="system_prompt" className="block text-sm font-medium text-neutral-700">
          Comportamiento del asesor (system prompt)
        </label>
        <textarea
          id="system_prompt"
          name="system_prompt"
          defaultValue={initialPrompt}
          rows={16}
          className="w-full rounded-lg border border-neutral-300 p-3 font-mono text-xs leading-relaxed outline-none focus:border-neutral-900"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
          {saveState.ok && <span className="text-sm text-green-600">Guardado ✓</span>}
          {saveState.error && <span className="text-sm text-red-600">{saveState.error}</span>}
        </div>
        <p className="text-xs text-neutral-400">Modelo: {model}</p>
      </form>

      {/* Chat de prueba (usa el prompt guardado) */}
      <div className="space-y-3">
        <form action={testAction} className="space-y-3">
          <label htmlFor="message" className="block text-sm font-medium text-neutral-700">
            Probar (mensaje de un cliente)
          </label>
          <input
            id="message"
            name="message"
            placeholder="ej: ¿tienen vestidos para fiesta?"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
          />
          <button
            type="submit"
            disabled={testing}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
          >
            {testing ? "Probando…" : "Enviar prueba"}
          </button>
        </form>

        {testState.error && <p className="text-sm text-red-600">{testState.error}</p>}
        {testState.reply && (
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="whitespace-pre-wrap text-sm text-neutral-800">{testState.reply}</p>
            {testState.tools.length > 0 && (
              <p className="mt-3 text-xs text-neutral-400">
                Herramientas usadas: {testState.tools.join(", ")}
              </p>
            )}
          </div>
        )}
        <p className="text-xs text-neutral-400">
          La prueba usa el prompt guardado. Guarda primero para probar cambios.
        </p>
      </div>
    </div>
  );
}
