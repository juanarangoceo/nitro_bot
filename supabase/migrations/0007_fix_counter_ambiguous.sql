-- ============================================================================
-- Nitro Bot — Migración #7: corrige increment_message_counter
-- ----------------------------------------------------------------------------
-- BUG: el RETURNING referenciaba `message_limit` sin calificar, y como la
-- función declara una columna de salida (RETURNS TABLE) también llamada
-- `message_limit`, Postgres lanzaba "column reference \"message_limit\" is
-- ambiguous". La RPC fallaba SIEMPRE y el contador de consumo nunca subía
-- (el worker no revisaba el error). Se califican las columnas con `tenants.`.
-- ============================================================================

create or replace function public.increment_message_counter(p_tenant_id uuid)
returns table (
  current_count int,
  message_limit int,
  over_limit    boolean,
  at_80_percent boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_limit int;
begin
  update tenants
    set current_month_messages =
          case when counter_period_start < date_trunc('month', now())
               then 1 else current_month_messages + 1 end,
        counter_period_start =
          case when counter_period_start < date_trunc('month', now())
               then date_trunc('month', now()) else counter_period_start end
  where id = p_tenant_id
  returning tenants.current_month_messages, tenants.message_limit
    into v_count, v_limit;

  return query select
    v_count,
    v_limit,
    (v_count > v_limit),
    (v_count >= (v_limit * 0.8)::int);
end;
$$;
