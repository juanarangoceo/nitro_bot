-- ============================================================================
-- Nitro Bot — Migración #5: habilitar Realtime en tablas del dashboard
-- ----------------------------------------------------------------------------
-- El dashboard escucha cambios en vivo (tickets que entran, mensajes nuevos).
-- Supabase Realtime (Postgres Changes) RESPETA RLS para el rol authenticated,
-- así que cada agente solo recibe eventos de SU tenant.
-- Idempotente: solo agrega la tabla a la publicación si no está ya.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tickets'
  ) then
    alter publication supabase_realtime add table public.tickets;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;
