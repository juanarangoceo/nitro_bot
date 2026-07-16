-- 0023: Identidad de usuarios del dashboard + autoría de respuestas.
-- (a) app_users.name: nombre visible del usuario (se gestiona desde /admin).
-- (b) messages.sent_by: QUÉ usuario del tenant envió un mensaje de agente
--     (control del admin: "Respondida por {nombre}"). Server-side siempre;
--     los 218 mensajes de agente históricos quedan NULL → "Agente".
-- (c) tickets.resolved_by: quién resolvió el ticket (auditoría).
-- (d) app_users_team_select: todo el equipo puede resolver id→nombre/email de
--     sus compañeros (antes solo self + admin); sin esto un agente no puede
--     ver quién respondió un mensaje. Solo SELECT: las escrituras siguen
--     siendo service_role (/admin).
-- (e) Advisor de Supabase: _migrations estaba sin RLS, expuesta a la anon key.
--     El runner (scripts/migrate.mjs) conecta como postgres (owner del la
--     tabla) y RLS no aplica al owner, así que habilitarla sin políticas solo
--     bloquea a anon/authenticated.

alter table app_users add column if not exists name text;

alter table messages
  add column if not exists sent_by uuid references app_users(id) on delete set null;

alter table tickets
  add column if not exists resolved_by uuid references app_users(id) on delete set null;

drop policy if exists app_users_team_select on app_users;
create policy app_users_team_select on app_users
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

alter table public._migrations enable row level security;
