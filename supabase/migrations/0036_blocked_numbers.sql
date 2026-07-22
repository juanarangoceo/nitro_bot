-- 0036: Números bloqueados por tenant. Un número bloqueado se IGNORA por
-- completo: el worker no responde ni persiste nada (mensaje/conversación/
-- CRM/media) ni toca el contador; los recordatorios de silencio y las
-- plantillas de carrito tampoco le escriben; su checkout ni se ingiere.
-- Administra el ADMIN del tenant desde /dashboard/blocklist («Bloqueados»).
-- Patrón 0021: RLS por verbo + rol, REVOKE obligatorio (default privileges
-- de 0002 dan ALL a authenticated) y grants por columna.

create table blocked_numbers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  phone      text not null, -- E.164 (+57...), misma normalización del worker
  note       text,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, phone) -- también es el índice del lookup del worker
);

alter table blocked_numbers enable row level security;

-- Todo el equipo LEE (Conversaciones puede mostrar el estado de bloqueo);
-- escribe solo el admin del tenant.
create policy blocked_numbers_select on blocked_numbers
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

create policy blocked_numbers_insert on blocked_numbers
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'admin'
  );

create policy blocked_numbers_delete on blocked_numbers
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'admin'
  );

revoke insert, update, delete on blocked_numbers from anon, authenticated;
grant insert (tenant_id, phone, note, created_by) on blocked_numbers to authenticated;
-- delete no admite grant por columna; lo acota la policy (solo admin).
grant delete on blocked_numbers to authenticated;
-- Sin UPDATE: cambiar = eliminar y volver a agregar.
