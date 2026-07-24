"use client";

import { useActionState } from "react";
import {
  createInvestment,
  type InvestmentState,
} from "./actions";

const INITIAL: InvestmentState = { ok: false, error: null };

export function InvestmentForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(createInvestment, INITIAL);

  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Fecha</span>
        <input
          type="date"
          name="investment_date"
          defaultValue={today}
          required
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Canal</span>
        <input
          name="channel"
          placeholder="Meta Ads, Google Ads…"
          maxLength={60}
          required
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Inversión (COP)</span>
        <input
          name="amount"
          inputMode="numeric"
          placeholder="500000"
          required
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Nota opcional</span>
        <input
          name="note"
          placeholder="Campaña o referencia"
          maxLength={160}
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <div className="flex items-center gap-3 md:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? "Guardando…" : "Registrar inversión"}
        </button>
        {state.ok && <span className="text-sm text-emerald-600">Registrada ✓</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
