-- 0026: Ciclo de facturación por pago (decisiones de Juan, 2026-07-17).
-- El ciclo NO lo manda el calendario sino el PAGO: al marcar pagada la factura
-- de renovación desde /admin, el contador vuelve a 0 y el corte se corre a
-- pago + 1 mes. Si el plan se agota antes del corte y el tenant tiene el
-- adicional activado, el bot sigue descontando del paquete de 2.000 con
-- factura pendiente; agotado TODO sin pagar, el bot se pausa (palanca de
-- cobro). La factura de renovación se genera al 80% del total del ciclo o 10
-- días antes del corte, lo que ocurra primero.
--
-- (a) invoices: facturas reales con historial. El cliente LEE las suyas
--     (/dashboard/plan, RLS); escribe SOLO service_role (revoke explícito,
--     patrón 0018 — los default privileges de 0002 dan ALL a authenticated).
--     cycle_start ancla la factura a su ciclo (= tenants.counter_period_start
--     al crearla) y da la idempotencia: una renovación y un adicional por ciclo.
-- (b) tenants.addon_enabled: toggle POR TENANT del paso automático al
--     adicional (apagado = al agotar el plan el bot se pausa como siempre).
-- (c) tenants.pending_plan: cambio de plan programado «al próximo ciclo»
--     ({message_limit, monthly_fee, plan}); se aplica al pagar la renovación.
-- (d) Los tenants CON fecha de corte salen del reseteo mensual automático
--     (perezoso y proactivo): su ciclo lo manda el pago. Los tenants sin
--     billing_due_date conservan el comportamiento mensual de siempre.

create table invoices (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  concept     text not null check (concept in ('renovacion','adicional')),
  amount      numeric not null default 0,
  status      text not null default 'pendiente' check (status in ('pendiente','pagada')),
  cycle_start timestamptz not null,
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);
create index invoices_tenant_idx on invoices(tenant_id, created_at desc);
-- Idempotencia dura: una factura por concepto por ciclo.
create unique index invoices_cycle_key on invoices(tenant_id, concept, cycle_start);

alter table invoices enable row level security;
create policy invoices_select on invoices
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
revoke insert, update, delete on invoices from anon, authenticated;

alter table tenants add column if not exists addon_enabled boolean not null default false;
alter table tenants add column if not exists pending_plan jsonb;

-- El reseteo perezoso del contador solo aplica a tenants SIN fecha de corte.
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
          case when billing_due_date is null
                    and counter_period_start < date_trunc('month', now())
               then 1 else current_month_messages + 1 end,
        counter_period_start =
          case when billing_due_date is null
                    and counter_period_start < date_trunc('month', now())
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

-- Ídem el reseteo proactivo del cron mensual.
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
  where billing_due_date is null
    and counter_period_start < date_trunc('month', now());
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
