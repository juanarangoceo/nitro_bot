-- 0025: search_log — demanda de búsqueda del canal WhatsApp, por tenant.
-- Alimenta el módulo «Búsquedas» del dashboard: palabras más buscadas,
-- productos más consultados y búsquedas con baja relevancia (demanda que el
-- catálogo no cubre). Se escribe best-effort desde las herramientas del
-- asesor (buscar_productos / ver_detalle_producto), donde el conteo y el
-- similarity aún están vivos — event_log NO sirve para esto: es solo
-- service_role, summarizeToolTrace descarta el resultado y se purga a 30 días.
--
-- RLS: el equipo del tenant LEE su propia demanda; escribe SOLO service_role
-- (OJO: los default privileges de 0002 dan ALL a authenticated → revoke
-- explícito, patrón 0018). Sin retención automática por ahora (volumen bajo);
-- si crece, sumar purga al cron mensual.

create table search_log (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  conversation_id    uuid references conversations(id) on delete set null,
  kind               text not null check (kind in ('search','detail')),
  query              text,     -- consulta textual (kind=search)
  product_shopify_id text,     -- producto consultado (kind=detail)
  result_count       int,      -- productos devueltos (search) / 1|0 (detail)
  top_similarity     numeric,  -- similarity del mejor match (search)
  created_at         timestamptz not null default now()
);

create index search_log_tenant_created_idx on search_log(tenant_id, created_at desc);

alter table search_log enable row level security;

create policy search_log_select on search_log
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

revoke insert, update, delete on search_log from anon, authenticated;
