-- ============================================================================
-- Nitro Bot — Migración #38: comprobantes de pago + inversión publicitaria
-- ============================================================================

-- Comprobante enviado por el cliente. La factura sigue pendiente hasta que un
-- super-admin la marque pagada: subir una imagen no confirma el pago.
alter table invoices add column if not exists payment_proof_path text;
alter table invoices add column if not exists payment_proof_mime text;
alter table invoices add column if not exists payment_proof_uploaded_at timestamptz;
alter table invoices add column if not exists payment_proof_submitted_by uuid
  references auth.users(id) on delete set null;

-- Bucket privado. Solo service_role accede a objetos; el cliente sube mediante
-- una Server Action que primero verifica tenant, rol y factura con RLS.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Inversión publicitaria declarada por el cliente. Una fila representa gasto
-- de un día/canal; varias filas del mismo día son válidas.
create table if not exists marketing_investments (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  investment_date date not null,
  channel         text not null,
  amount          numeric not null check (amount > 0),
  note            text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists marketing_investments_tenant_date_idx
  on marketing_investments (tenant_id, investment_date desc);

alter table marketing_investments enable row level security;

-- Todo el equipo puede ver la métrica; solo el admin del tenant administra la
-- inversión. current_user_role() fue creada en la migración 0021.
create policy marketing_investments_select on marketing_investments
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

create policy marketing_investments_insert on marketing_investments
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'admin'
    and created_by = auth.uid()
  );

create policy marketing_investments_update on marketing_investments
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'admin'
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'admin'
  );

create policy marketing_investments_delete on marketing_investments
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'admin'
  );
