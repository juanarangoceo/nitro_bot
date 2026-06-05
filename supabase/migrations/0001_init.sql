-- ============================================================================
-- Nitro Bot — Migración #1: esquema multi-tenant + RLS + pgvector
-- ----------------------------------------------------------------------------
-- Reglas no negociables aplicadas aquí:
--   * tenant_id en toda tabla de negocio
--   * RLS activado desde esta primera migración
--   * pgvector para búsqueda semántica del catálogo
--   * credenciales por tenant en tabla aparte, accesible solo por service_role
--   * idempotencia por wa_message_id
--   * contador de consumo atómico con reseteo mensual
-- ============================================================================

create extension if not exists vector;

-- ============================================================================
-- TENANTS — configuración pública/operativa de cada tienda (NO secretos)
-- ============================================================================
create table tenants (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  slug                   text unique,                       -- identificador legible

  -- Identificadores de integración (no sensibles; usados para enrutar webhooks)
  shopify_domain         text unique,                       -- xxx.myshopify.com
  wa_phone_number_id     text unique,                       -- id del número en Meta
  wa_business_account_id text,

  -- Comportamiento del asesor
  system_prompt          text,
  ai_model               text not null default 'gemini-2.5-flash-lite',
  embedding_model        text not null default 'gemini-embedding-001',
  embedding_dim          int  not null default 768,

  -- Reglas de negocio configurables
  shipping_rules         jsonb not null default '{}'::jsonb, -- para calcular_envio()
  payment_mode           text  not null default 'cod',        -- contraentrega por defecto

  -- Consumo / límites
  message_limit          int  not null default 3000,
  current_month_messages int  not null default 0,
  counter_period_start   timestamptz not null default date_trunc('month', now()),

  -- Interruptores de módulos del dashboard
  modules                jsonb not null default
    '{"tickets":true,"metrics":true,"crm":true,"editor":true}'::jsonb,

  is_active              boolean not null default true,
  created_at             timestamptz not null default now()
);

-- ============================================================================
-- TENANT_SECRETS — credenciales cifradas. SOLO accesible por service_role.
-- (RLS activado SIN políticas para authenticated => el dashboard nunca las ve)
-- Los valores se guardan cifrados en la app (AES-256-GCM, TENANT_SECRET_ENC_KEY).
-- ============================================================================
create table tenant_secrets (
  tenant_id              uuid primary key references tenants(id) on delete cascade,
  shopify_access_token   text,   -- cifrado
  shopify_webhook_secret text,   -- cifrado (HMAC de Shopify)
  wa_access_token        text,   -- cifrado (Cloud API)
  updated_at             timestamptz not null default now()
);

-- ============================================================================
-- APP_USERS — usuarios del dashboard, atados a un tenant
-- ============================================================================
create table app_users (
  id         uuid primary key references auth.users(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  email      text,
  role       text not null default 'agent' check (role in ('agent','admin')),
  created_at timestamptz not null default now()
);
create index app_users_tenant_idx on app_users(tenant_id);

-- ----------------------------------------------------------------------------
-- Helper: tenant_id del usuario autenticado.
-- SECURITY DEFINER para evitar recursión de RLS al leer app_users.
-- STABLE => el planner lo evalúa una vez por query (con el patrón (select ...)).
-- ----------------------------------------------------------------------------
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.app_users where id = auth.uid()
$$;

-- ============================================================================
-- PRODUCTS — catálogo sincronizado desde Shopify + embedding
-- ============================================================================
create table products (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  shopify_id        text not null,
  handle            text,
  title             text,
  description       text,
  price             numeric,
  compare_at_price  numeric,
  stock             int,
  image_url         text,
  status            text default 'active',   -- active / archived / draft
  embedding         vector(768),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, shopify_id)
);
create index products_tenant_idx on products(tenant_id);
-- HNSW: mejor que ivfflat para catálogos pequeños/medianos por tenant.
create index products_embedding_idx on products
  using hnsw (embedding vector_cosine_ops);

-- ============================================================================
-- CONVERSATIONS
-- ============================================================================
create type conv_status as enum ('bot_active','requires_human','human_active','closed');

create table conversations (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id) on delete cascade,
  customer_phone           text not null,
  status                   conv_status not null default 'bot_active',
  last_customer_message_at timestamptz,   -- para la ventana de servicio de 24h
  created_at               timestamptz not null default now(),
  unique (tenant_id, customer_phone)
);
create index conversations_tenant_status_idx on conversations(tenant_id, status);

-- ============================================================================
-- MESSAGES — historial; idempotencia por wa_message_id
-- ============================================================================
create table messages (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  conversation_id  uuid not null references conversations(id) on delete cascade,
  wa_message_id    text,                       -- id de Meta, para deduplicar
  sender           text not null check (sender in ('customer','bot','agent')),
  msg_type         text not null default 'text'
                     check (msg_type in ('text','audio','image','other')),
  content          text,                       -- texto (o transcripción del audio)
  media_url        text,                       -- audio/imagen original si aplica
  created_at       timestamptz not null default now(),
  unique (tenant_id, wa_message_id)            -- clave de idempotencia
);
create index messages_conversation_idx on messages(conversation_id, created_at);

-- ============================================================================
-- TICKETS — escaladas asíncronas
-- ============================================================================
create table tickets (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  conversation_id  uuid not null references conversations(id) on delete cascade,
  reason           text,           -- reclamo / fuera_de_catalogo / pide_humano / audio
  status           text not null default 'open' check (status in ('open','resolved')),
  assigned_to      uuid references app_users(id),
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);
create index tickets_tenant_status_idx on tickets(tenant_id, status);

-- ============================================================================
-- ORDERS
-- ============================================================================
create table orders (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  conversation_id  uuid references conversations(id) on delete set null,
  shopify_order_id text,
  total            numeric,
  channel          text not null check (channel in ('bot','agent')),
  created_at       timestamptz not null default now()
);
create index orders_tenant_idx on orders(tenant_id, created_at);

-- ============================================================================
-- CUSTOMERS — base para el CRM
-- ============================================================================
create table customers (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  phone               text not null,
  name                text,
  city                text,
  shopify_customer_id text,
  total_spent         numeric not null default 0,
  first_contact       timestamptz not null default now(),
  unique (tenant_id, phone)
);
create index customers_tenant_idx on customers(tenant_id);

-- ============================================================================
-- FUNCIONES DE NEGOCIO (server-side, SECURITY DEFINER)
-- ============================================================================

-- Búsqueda semántica de productos filtrada por tenant.
create or replace function public.match_products(
  p_tenant_id      uuid,
  p_query_embedding vector(768),
  p_match_count    int default 5
)
returns table (
  id          uuid,
  shopify_id  text,
  title       text,
  description text,
  price       numeric,
  stock       int,
  image_url   text,
  similarity  float
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.shopify_id, p.title, p.description, p.price, p.stock, p.image_url,
         1 - (p.embedding <=> p_query_embedding) as similarity
  from products p
  where p.tenant_id = p_tenant_id
    and p.embedding is not null
  order by p.embedding <=> p_query_embedding
  limit p_match_count
$$;

-- Incremento atómico del contador de consumo, con reseteo mensual perezoso.
-- Devuelve el estado para decidir si se sigue respondiendo y si se alerta al 80%.
create or replace function public.increment_message_counter(p_tenant_id uuid)
returns table (
  current_count int,
  message_limit int,
  over_limit    boolean,
  at_80_percent boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_limit int;
begin
  update tenants
    set current_month_messages =
          case when counter_period_start < date_trunc('month', now())
               then 1 else current_month_messages + 1 end,
        counter_period_start =
          case when counter_period_start < date_trunc('month', now())
               then date_trunc('month', now()) else counter_period_start end
  where id = p_tenant_id
  returning current_month_messages, message_limit into v_count, v_limit;

  return query select
    v_count,
    v_limit,
    (v_count > v_limit),
    (v_count >= (v_limit * 0.8)::int);
end;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Patrón: el dashboard (rol authenticated) solo ve filas de SU tenant.
-- Las rutas server-side (webhooks, worker) usan service_role, que ignora RLS
-- y resuelve el tenant_id explícitamente.
-- ============================================================================

-- tenant_secrets: RLS sin políticas => authenticated/anon NO leen nada.
alter table tenant_secrets enable row level security;

-- tenants: cada usuario ve solo su tienda.
alter table tenants enable row level security;
create policy tenant_self_select on tenants
  for select to authenticated
  using (id = (select public.current_tenant_id()));

-- app_users: cada usuario ve solo su propia fila.
alter table app_users enable row level security;
create policy app_users_self on app_users
  for select to authenticated
  using (id = auth.uid());

-- Tablas de negocio: aislamiento por tenant_id.
alter table products      enable row level security;
alter table conversations enable row level security;
alter table messages      enable row level security;
alter table tickets       enable row level security;
alter table orders        enable row level security;
alter table customers     enable row level security;

create policy tenant_isolation on products
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

create policy tenant_isolation on conversations
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

create policy tenant_isolation on messages
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

create policy tenant_isolation on tickets
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

create policy tenant_isolation on orders
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

create policy tenant_isolation on customers
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
