-- 0034: Entregabilidad de carritos abandonados.
-- La Cloud API acepta el envío (wamid) aunque no pueda entregar; el resultado
-- real llega después como status delivered/failed por el webhook. Estas
-- columnas guardan el wamid de cada recordatorio (correlación con statuses),
-- el estado de entrega real, el reintento programado (error 131049 de Meta),
-- los clicks del redirect propio (/r/c/{id}) y el flag de número sin WhatsApp
-- en customers. RLS de 0028 ya cubre las columnas nuevas (lectura por tenant,
-- escritura solo service_role): sin cambios de policies ni grants.

alter table abandoned_checkouts
  add column if not exists reminder_1_wamid        text,
  add column if not exists reminder_2_wamid        text,
  add column if not exists reminder_1_delivery     text not null default 'none'
    check (reminder_1_delivery in ('none', 'accepted', 'delivered', 'failed')),
  add column if not exists reminder_2_delivery     text not null default 'none'
    check (reminder_2_delivery in ('none', 'accepted', 'delivered', 'failed')),
  add column if not exists reminder_1_delivered_at timestamptz,
  add column if not exists reminder_2_delivered_at timestamptz,
  add column if not exists next_retry_at           timestamptz,
  add column if not exists delivery_retries        int not null default 0,
  add column if not exists clicked_at              timestamptz,
  add column if not exists click_count             int not null default 0;

-- Correlación wamid → checkout (webhook de statuses, un lookup por evento).
create index if not exists abandoned_checkouts_wamid1_idx
  on abandoned_checkouts (reminder_1_wamid) where reminder_1_wamid is not null;
create index if not exists abandoned_checkouts_wamid2_idx
  on abandoned_checkouts (reminder_2_wamid) where reminder_2_wamid is not null;

-- El recordatorio 2 pasa a contar desde el envío del 1 (no desde
-- last_activity_at, que cada checkouts/update de Shopify reprograma).
create index if not exists abandoned_checkouts_r1_sweep_idx
  on abandoned_checkouts (tenant_id, reminder_1_sent_at) where status = 'reminded_1';

-- Error 131026 (número sin WhatsApp): jamás reintentar marketing a ese número.
alter table customers add column if not exists wa_undeliverable_at timestamptz;
