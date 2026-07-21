-- ============================================================================
-- Nitro Bot — Migración #33: historial del asistente de Telegram del dueño
--
-- Conversación Juan ↔ IA por Telegram (webhook /api/telegram/webhook). Solo
-- infraestructura de plataforma: RLS activado SIN políticas + revoke (patrón
-- platform_admins/audit_log de 0008) — únicamente service_role la toca.
-- ============================================================================

create table if not exists admin_chat_log (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists admin_chat_log_created_idx on admin_chat_log (created_at desc);

alter table admin_chat_log enable row level security;
revoke all on table admin_chat_log from anon, authenticated;
