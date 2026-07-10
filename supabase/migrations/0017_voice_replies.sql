-- ============================================================================
-- Nitro Bot — Migración #17: respuestas de voz (Mistral Voxtral TTS)
--
-- Feature premium por cliente: si el cliente final manda una nota de voz, el
-- bot responde con audio (TTS de Mistral sobre el texto que genera Gemini).
-- Solo ADITIVO.
--
--   * tenants.voice_replies_enabled — toggle premium (default OFF; se activa
--     por cliente desde /admin).
--   * tenants.voice_id — voz de Mistral propia del cliente; NULL = usar la voz
--     global de la plataforma (env MISTRAL_VOICE_ID). No es secreto.
-- ============================================================================

alter table tenants add column if not exists voice_replies_enabled boolean not null default false;
alter table tenants add column if not exists voice_id text;
