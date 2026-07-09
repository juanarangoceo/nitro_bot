-- La disponibilidad la define el status de Shopify (active), no el stock:
-- las tiendas con "seguir vendiendo sin inventario" pueden tener stock 0 o
-- negativo y aun así vender. Solo productos activos entran al RAG del asesor.

update products set status = 'active' where status is null;

-- Mismo returns table que 0001 => no requiere DROP y conserva grants
-- (security definer).
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
    and p.status = 'active'
  order by p.embedding <=> p_query_embedding
  limit p_match_count
$$;
