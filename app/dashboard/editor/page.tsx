import { getDashboardContext } from "@/lib/dashboard/context";
import { EditorClient } from "./editor-client";

export default async function EditorPage() {
  const { tenant } = await getDashboardContext();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Asesor</h1>
        <p className="text-sm text-neutral-500">
          Edita cómo se comporta tu asesor y pruébalo en vivo.
        </p>
      </header>

      <EditorClient initialPrompt={tenant.system_prompt ?? ""} model={tenant.ai_model} />
    </div>
  );
}
