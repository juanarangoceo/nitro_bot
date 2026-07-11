-- 0018: Módulo «Solicitudes» — soporte asíncrono cliente ↔ plataforma.
-- El tenant registra solicitudes (ajustes del asesor, reportes, sugerencias)
-- desde su dashboard; la plataforma las gestiona desde /admin (service_role).
--
-- Seguridad: el cliente (authenticated) solo puede crear solicitudes, leerlas,
-- comentar y cerrar las propias. status/eta_date/rejection_note son campos de
-- la plataforma: se bloquean a nivel de DB con grants por columna + policies
-- (0002 otorga ALL a authenticated en tablas nuevas vía default privileges,
-- por eso el REVOKE explícito).

create table if not exists support_requests (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  created_by        uuid references app_users(id) on delete set null,
  category          text not null check (category in
                      ('ajuste_asesor','reporte_error','sugerencia','otro')),
  subject           text not null,
  description       text not null,
  status            text not null default 'nueva' check (status in
                      ('nueva','en_revision','aprobada','en_proceso','resuelta',
                       'rechazada','cerrada_por_cliente')),
  eta_date          date,          -- fecha ESTIMADA de implementación (opcional)
  rejection_note    text,          -- motivo amable cuando status = 'rechazada'
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  status_changed_at timestamptz not null default now()
);

create index if not exists support_requests_tenant_idx
  on support_requests(tenant_id, status, created_at desc);
-- Bandeja de /admin: nuevas primero, luego recientes.
create index if not exists support_requests_status_idx
  on support_requests(status, created_at desc);

create table if not exists support_request_comments (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references support_requests(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  author_role text not null check (author_role in ('client','platform_admin')),
  author_id   uuid,               -- app_users.id o platform_admins.id según el rol
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists support_request_comments_request_idx
  on support_request_comments(request_id, created_at);

-- ── RLS: aislamiento por tenant con verbos separados ────────────────────────
alter table support_requests enable row level security;

create policy support_requests_select on support_requests
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

create policy support_requests_insert on support_requests
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()));

-- Único update permitido al cliente: cerrar su propia solicitud.
create policy support_requests_close on support_requests
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id())
              and status = 'cerrada_por_cliente');

-- Grants por columna: el cliente solo escribe lo suyo; nunca status/eta/nota.
revoke insert, update, delete on support_requests from anon, authenticated;
grant insert (tenant_id, created_by, category, subject, description)
  on support_requests to authenticated;
grant update (status) on support_requests to authenticated;

alter table support_request_comments enable row level security;

create policy support_request_comments_select on support_request_comments
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

-- El cliente solo comenta como 'client' y firmando con su propio uid.
create policy support_request_comments_insert on support_request_comments
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id())
              and author_role = 'client'
              and author_id = (select auth.uid()));

revoke update, delete on support_request_comments from anon, authenticated;
