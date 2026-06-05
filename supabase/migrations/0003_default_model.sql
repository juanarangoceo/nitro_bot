-- ============================================================================
-- Migración #3: modelo de chat por defecto = gemini-3.5-flash.
-- Gemini 3.5 Flash es GA, fiable en function calling (vs flash-lite, que
-- decidía de forma inconsistente cuándo usar las herramientas).
-- ============================================================================

alter table tenants alter column ai_model set default 'gemini-3.5-flash';

update tenants
  set ai_model = 'gemini-3.5-flash'
  where ai_model in ('gemini-2.5-flash-lite', 'gemini-flash-lite');
