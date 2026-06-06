-- ============================================================================
-- Nitro Bot — Migración #8: Panel de Plataforma + multimedia + métricas de producto
-- ----------------------------------------------------------------------------
-- Agrega:
--   * platform_admins  — super-admins de la plataforma, SEPARADO de app_users.
--   * audit_log         — auditoría de acciones de super-admin.
--   * columnas comerciales/operativas en tenants (plan, fee, perfil WA).
--   * order_items       — líneas de orden para métricas de productos más vendidos.
--   * messages.media_path / media_mime — media persistida en Supabase Storage.
--
-- Seguridad (reglas no negociables de esta fase):
--   * platform_admins y audit_log: RLS activado SIN políticas + revoke a anon/
--     authenticated => un cliente jamás las lee ni escribe. Solo service_role.
--   * order_items: aislamiento por tenant_id (mismo patrón que el resto).
-- ============================================================================

-- ── Super-admins de la plataforma ───────────────────────────────────────────
create table if not exists platform_admins (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;
-- Sin políticas: authenticated/anon no ven nada. Defensa en profundidad: revoke.
revoke all on table platform_admins from anon, authenticated;

-- ── Auditoría de acciones de super-admin ────────────────────────────────────
create table if not exists audit_log (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid references platform_admins(id) on delete set null,
  action     text not null,          -- 'provision_tenant' | 'deactivate' | 'reactivate' | 'rotate_creds' | 'update_prompt' | ...
  tenant_id  uuid references tenants(id) on delete set null,
  detail     jsonb,                  -- metadatos NO sensibles (nunca tokens en claro)
  created_at timestamptz not null default now()
);
create index if not exists audit_log_tenant_idx on audit_log(tenant_id, created_at desc);
alter table audit_log enable row level security;
revoke all on table audit_log from anon, authenticated;

-- ── Campos comerciales/operativos en tenants ────────────────────────────────
alter table tenants add column if not exists plan                 text;
alter table tenants add column if not exists monthly_fee          numeric;  -- mensualidad pactada (COP)
alter table tenants add column if not exists wa_display_name      text;     -- referencia del perfil en Meta
alter table tenants add column if not exists wa_profile_photo_url text;     -- referencia (la foto vive en Meta)

-- ── Líneas de orden (para "productos más vendidos") ──────────────────────────
create table if not exists order_items (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  order_id           uuid not null references orders(id) on delete cascade,
  shopify_product_id text,
  title              text,
  quantity           int not null default 1,
  unit_price         numeric,
  created_at         timestamptz not null default now()
);
create index if not exists order_items_tenant_idx on order_items(tenant_id, created_at);
create index if not exists order_items_product_idx on order_items(tenant_id, shopify_product_id);

alter table order_items enable row level security;
create policy tenant_isolation on order_items
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- ── Media persistida en Storage (bucket privado wa-media) ────────────────────
alter table messages add column if not exists media_path text;  -- key del objeto en Storage
alter table messages add column if not exists media_mime text;
