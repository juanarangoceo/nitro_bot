-- 0021: Etiquetas de tickets por tenant + asignación por usuario.
-- El bot clasifica cada ticket con una etiqueta (la elige la IA de la lista
-- del tenant, con fallback determinista motivo→etiqueta en el server). Cada
-- usuario del dashboard tiene etiquetas asignadas: en /dashboard/tickets un
-- agente ve solo los tickets de sus etiquetas + los tickets sin etiqueta;
-- un agente sin etiquetas asignadas ve todo; el admin del tenant ve todo y
-- administra etiquetas y asignaciones desde /dashboard/labels.
--
-- Seguridad: solo el admin del tenant escribe ticket_labels/app_user_labels
-- (0002 otorga ALL a authenticated en tablas nuevas vía default privileges,
-- por eso el REVOKE explícito + grants por columna, patrón de 0018).

-- ----------------------------------------------------------------------------
-- Helper: rol del usuario autenticado (análogo a current_tenant_id, ver 0001).
-- SECURITY DEFINER para evitar recursión de RLS al leer app_users.
-- ----------------------------------------------------------------------------
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.app_users where id = auth.uid()
$$;

-- El admin del tenant necesita LISTAR su equipo para asignar etiquetas
-- (hasta ahora app_users solo tenía la policy self, ver 0001).
create policy app_users_admin_select on app_users
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_user_role()) = 'admin');

-- ============================================================================
-- TICKET_LABELS — etiquetas por tenant (CRUD del admin del tenant)
-- ============================================================================
create table if not exists ticket_labels (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (id, tenant_id)  -- ancla para la FK compuesta anti cross-tenant
);

create index if not exists ticket_labels_tenant_idx
  on ticket_labels(tenant_id, is_active);

-- Ancla equivalente en app_users para la FK compuesta de app_user_labels.
alter table app_users add constraint app_users_id_tenant_key unique (id, tenant_id);

-- ============================================================================
-- APP_USER_LABELS — etiquetas asignadas a cada usuario del dashboard
-- ============================================================================
-- Las FKs compuestas garantizan a nivel de DB que usuario y etiqueta
-- pertenecen al MISMO tenant que la fila (imposible cruzar tenants).
create table if not exists app_user_labels (
  user_id    uuid not null,
  label_id   uuid not null,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, label_id),
  foreign key (user_id,  tenant_id) references app_users(id, tenant_id)     on delete cascade,
  foreign key (label_id, tenant_id) references ticket_labels(id, tenant_id) on delete cascade
);

-- Clasificación del ticket. Si la etiqueta se borra, el ticket queda sin
-- etiqueta (visible para todos) — nunca se pierde el ticket.
alter table tickets add column label_id uuid references ticket_labels(id) on delete set null;

create index if not exists tickets_label_idx
  on tickets(label_id) where label_id is not null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table ticket_labels enable row level security;

create policy ticket_labels_select on ticket_labels
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

create policy ticket_labels_insert on ticket_labels
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.current_user_role()) = 'admin');

create policy ticket_labels_update on ticket_labels
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_user_role()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()));

create policy ticket_labels_delete on ticket_labels
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_user_role()) = 'admin');

revoke insert, update, delete on ticket_labels from anon, authenticated;
grant insert (tenant_id, name, is_active) on ticket_labels to authenticated;
grant update (name, is_active)            on ticket_labels to authenticated;
-- delete no admite grant por columna; lo acota la policy (solo admin).
grant delete on ticket_labels to authenticated;

alter table app_user_labels enable row level security;

-- Cada usuario lee sus propias asignaciones; el admin lee las de su tenant.
create policy app_user_labels_select on app_user_labels
  for select to authenticated
  using (user_id = auth.uid()
         or (tenant_id = (select public.current_tenant_id())
             and (select public.current_user_role()) = 'admin'));

create policy app_user_labels_insert on app_user_labels
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.current_user_role()) = 'admin');

create policy app_user_labels_delete on app_user_labels
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_user_role()) = 'admin');

revoke insert, update, delete on app_user_labels from anon, authenticated;
grant insert (tenant_id, user_id, label_id) on app_user_labels to authenticated;
grant delete on app_user_labels to authenticated;

-- ── Seed: etiquetas por defecto para los tenants existentes ─────────────────
-- (los tenants nuevos las reciben en el alta, ver lib/provisioning/tenant.ts)
insert into ticket_labels (tenant_id, name)
select t.id, v.name
from tenants t
cross join (values
  ('Servicio al cliente'),
  ('Ventas'),
  ('Garantías'),
  ('Reclamos'),
  ('Logística/Guías')
) v(name)
on conflict (tenant_id, name) do nothing;
