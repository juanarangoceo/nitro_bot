-- ============================================================================
-- Nitro Bot — Migración #6: reseteo mensual del contador de consumo (cron)
-- ----------------------------------------------------------------------------
-- increment_message_counter() ya hace un reseteo PEREZOSO (al primer mensaje del
-- mes). Esta función permite además un reseteo PROACTIVO vía cron, para que el
-- dashboard muestre 0 al iniciar el mes aunque todavía no llegue ningún mensaje.
-- Resetea solo los tenants cuyo período quedó en un mes anterior. Idempotente.
-- ============================================================================

create or replace function public.reset_stale_message_counters()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update tenants
    set current_month_messages = 0,
        counter_period_start    = date_trunc('month', now())
  where counter_period_start < date_trunc('month', now());
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
