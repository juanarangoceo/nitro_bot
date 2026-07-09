"use client";

import { clearCrm } from "./actions";

export function ClearCrmButton({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <form
      action={clearCrm}
      onSubmit={(e) => {
        if (
          !confirm(
            `¿Vaciar el CRM? Se eliminarán ${count} cliente(s) DEFINITIVAMENTE. Te recomendamos exportar el CSV antes.`
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
      >
        Vaciar CRM
      </button>
    </form>
  );
}
