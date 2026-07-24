-- ============================================================================
-- Nitro Bot — Migración #40: métricas agregadas de mensajes enviados por bot
--
-- El panel nunca descarga el historial: PostgreSQL agrupa y devuelve como
-- máximo 4 filas por tenant. Solo service_role puede ejecutar la función.
-- ============================================================================

create index if not exists messages_bot_metrics_idx
  on messages (tenant_id, msg_type, created_at)
  where sender = 'bot';

create or replace function public.admin_bot_message_counts(
  p_tenant_id uuid default null
)
returns table (
  tenant_id uuid,
  tenant_name text,
  msg_type text,
  message_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.tenant_id,
    t.name as tenant_name,
    m.msg_type,
    count(*)::bigint as message_count
  from public.messages m
  join public.tenants t on t.id = m.tenant_id
  join public.conversations c on c.id = m.conversation_id
  where m.sender = 'bot'
    and m.msg_type in ('text', 'image', 'audio', 'video')
    and c.is_test = false
    and (p_tenant_id is null or m.tenant_id = p_tenant_id)
  group by m.tenant_id, t.name, m.msg_type
  order by t.name, m.msg_type
$$;

revoke execute on function public.admin_bot_message_counts(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_bot_message_counts(uuid)
  to service_role;
