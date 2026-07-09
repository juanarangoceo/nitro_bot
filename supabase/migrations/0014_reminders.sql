-- ============================================================================
-- Nitro Bot — Migración #14: recordatorios automáticos (follow-up)
--
-- El bot hace máximo 2 follow-ups a conversaciones que quedan a medias, DENTRO
-- de la ventana de 24h de WhatsApp (~4h y ~22h de silencio). Solo ADITIVO.
--
--   * conversations.reminder_count   — recordatorios enviados en el episodio
--     de silencio actual (el worker lo vuelve a 0 cuando el cliente escribe).
--   * conversations.last_reminder_at — último recordatorio enviado.
--   * tenants.reminders_enabled      — kill-switch por cliente (default on).
-- ============================================================================

alter table conversations add column if not exists reminder_count int not null default 0;
alter table conversations add column if not exists last_reminder_at timestamptz;
alter table tenants add column if not exists reminders_enabled boolean not null default true;
