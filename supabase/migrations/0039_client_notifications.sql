-- ============================================================================
-- Nitro Bot — Migración #39: notificaciones internas por tenant/usuario
--
-- La plataforma crea una fila por tenant. Cada usuario puede descartarla para
-- sí mismo sin afectar a sus compañeros. El original se conserva y el
-- super-admin puede archivarlo globalmente.
-- ============================================================================

create table client_notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  title       text not null,
  body        text not null,
  tone        text not null default 'info'
                check (tone in ('info', 'warning', 'urgent')),
  created_by  uuid references platform_admins(id) on delete set null,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id)
);

create index client_notifications_tenant_idx
  on client_notifications (tenant_id, is_archived, created_at desc);

create table client_notification_dismissals (
  notification_id uuid not null,
  user_id          uuid not null references app_users(id) on delete cascade,
  tenant_id        uuid not null references tenants(id) on delete cascade,
  dismissed_at     timestamptz not null default now(),
  primary key (notification_id, user_id),
  foreign key (notification_id, tenant_id)
    references client_notifications(id, tenant_id) on delete cascade,
  foreign key (user_id, tenant_id)
    references app_users(id, tenant_id) on delete cascade
);

create index client_notification_dismissals_user_idx
  on client_notification_dismissals (user_id, dismissed_at desc);

alter table client_notifications enable row level security;
alter table client_notification_dismissals enable row level security;

create policy client_notifications_select on client_notifications
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

-- El cliente nunca crea, modifica o borra el mensaje original.
revoke insert, update, delete on client_notifications from anon, authenticated;

create policy notification_dismissals_select on client_notification_dismissals
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
  );

create policy notification_dismissals_insert on client_notification_dismissals
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
  );

-- No se permite borrar el descarte desde el dashboard: la X es definitiva para
-- ese usuario. El original sigue disponible para auditoría de plataforma.
revoke update, delete on client_notification_dismissals from anon, authenticated;

alter publication supabase_realtime add table client_notifications;
alter publication supabase_realtime add table client_notification_dismissals;
