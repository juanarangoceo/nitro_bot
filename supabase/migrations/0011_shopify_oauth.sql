-- ============================================================================
-- Nitro Bot — Migración #11: OAuth de Shopify (token automático por tenant)
-- ----------------------------------------------------------------------------
-- Desde 2026 las apps custom se crean en el Dev Dashboard y se instalan vía
-- OAuth (authorization code grant, flujo heredado → token offline permanente).
-- El operador guarda el client_id/client_secret de la app del cliente y el
-- panel completa el flujo: el access token queda cifrado en tenant_secrets.
--
-- Solo cambios ADITIVOS.
-- ============================================================================

-- Credenciales de la app de Shopify por tenant. client_id no es secreto
-- (viaja en la URL de autorización) y se guarda en claro; client_secret va
-- CIFRADO con el mismo esquema AES-256-GCM de los demás secretos.
alter table tenant_secrets add column if not exists shopify_client_id text;
alter table tenant_secrets add column if not exists shopify_client_secret text; -- cifrado

-- Estado efímero del flujo OAuth (anti-CSRF, un solo uso, expira a los 10 min).
-- Tabla de PLATAFORMA: RLS activado sin políticas + revoke (solo service_role).
-- admin_id: quién inició la conexión (para la auditoría del callback, que es
-- una ruta pública sin sesión).
create table if not exists shopify_oauth_states (
  state       text primary key,        -- aleatorio criptográfico (32 bytes hex)
  tenant_id   uuid not null references tenants(id) on delete cascade,
  shop_domain text not null,
  admin_id    uuid references platform_admins(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table shopify_oauth_states enable row level security;
revoke all on table shopify_oauth_states from anon, authenticated;
