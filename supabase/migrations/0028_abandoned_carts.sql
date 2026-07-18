-- 0028: Carritos abandonados (Spec 13) — recuperación por WhatsApp con
-- plantillas de marketing de Meta (máx 2 recordatorios por checkout).
--
-- * abandoned_checkouts: un checkout de Shopify con teléfono que no terminó en
--   compra. Los webhooks checkouts/create|update lo upsertean (idempotencia por
--   (tenant_id, checkout_token)); orders/create lo cierra (recovered/cancelled);
--   el cron /api/cron/cart-reminders envía las plantillas y avanza el estado.
--   Estados SOLO hacia adelante: pending → reminded_1 → reminded_2 →
--   terminal (recovered | cancelled | opted_out | expired).
-- * customers.marketing_opt_out: el comprador escribió BAJA — bloquea SOLO el
--   marketing saliente; el bot le sigue respondiendo normal.
-- * tenants.abandoned_carts_enabled + cart_settings: switch y configuración por
--   tenant (delays, nombres de plantilla, idioma, base de la URL del botón).
--
-- RLS: el equipo del tenant LEE sus carritos; escribe SOLO service_role
-- (OJO: los default privileges de 0002 dan ALL a authenticated → revoke
-- explícito, patrón 0018/0025).

create table abandoned_checkouts (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references tenants(id) on delete cascade,
  checkout_token              text not null,       -- idempotencia de webhooks
  shopify_checkout_id         text,
  phone                       text not null,       -- E.164 (sin teléfono no se persiste)
  customer_name               text,
  line_items                  jsonb not null default '[]', -- [{title, quantity, price}]
  total_price                 numeric,
  currency                    text,
  abandoned_checkout_url      text,
  status                      text not null default 'pending'
                                check (status in ('pending','reminded_1','reminded_2',
                                                  'recovered','cancelled','opted_out','expired')),
  -- Reloj de los recordatorios: cada checkouts/update lo reprograma (los
  -- delays cuentan desde la ÚLTIMA actividad del checkout, no su creación).
  last_activity_at            timestamptz not null default now(),
  reminder_1_sent_at          timestamptz,
  reminder_2_sent_at          timestamptz,
  send_attempts               int not null default 0, -- reintentos del envío pendiente (máx 1 extra)
  -- Orden que lo cerró. Es el id de SHOPIFY (texto), no FK local: las compras
  -- recuperadas por la web nunca existen en nuestra tabla orders (solo bot/agent).
  recovered_shopify_order_id  text,
  recovered_at                timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (tenant_id, checkout_token)
);

create index abandoned_checkouts_tenant_created_idx
  on abandoned_checkouts(tenant_id, created_at desc);
-- Barrido del cron: solo estados con recordatorio pendiente.
create index abandoned_checkouts_sweep_idx
  on abandoned_checkouts(tenant_id, last_activity_at)
  where status in ('pending','reminded_1');
-- Cierre por teléfono (orders/create sin checkout_token, opt-out del comprador).
create index abandoned_checkouts_phone_idx on abandoned_checkouts(tenant_id, phone);

alter table abandoned_checkouts enable row level security;

create policy abandoned_checkouts_select on abandoned_checkouts
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

revoke insert, update, delete on abandoned_checkouts from anon, authenticated;

-- Opt-out de marketing (el comprador escribió BAJA). Solo bloquea salientes
-- promocionales; nunca las respuestas del asesor.
alter table customers add column if not exists marketing_opt_out boolean not null default false;

-- Switch del módulo + configuración por tenant. cart_settings (jsonb):
--   { "delays_minutes": [60, 1440], "template_1": "carrito_recordatorio_1",
--     "template_2": "carrito_recordatorio_2", "template_language": "es_CO",
--     "checkout_url_base": "https://dominio/checkouts/cn/" }
-- Los defaults viven en lib/carts/settings.ts; aquí solo el contenedor.
alter table tenants add column if not exists abandoned_carts_enabled boolean not null default false;
alter table tenants add column if not exists cart_settings jsonb not null default '{}';
