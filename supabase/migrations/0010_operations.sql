-- ============================================================================
-- Nitro Bot — Migración #10: Operación y Robustez (spec 07)
-- ----------------------------------------------------------------------------
-- Agrega:
--   * event_log — log de eventos de plataforma (errores, trazas de
--     herramientas, notificaciones, backups). Tabla de PLATAFORMA: RLS
--     activado SIN políticas + revoke a anon/authenticated (igual que
--     audit_log). Acceso solo vía service_role; el dashboard del cliente
--     nunca la lee.
--   * tenants.notification_email — correo del equipo del cliente para avisos
--     de tickets (Resend).
--   * conversations.is_test — marca conversaciones del probador del /admin
--     para excluirlas de métricas, CRM y resúmenes.
--   * conversations.closed_at — corte de contexto al cerrar: al reactivarse
--     la conversación, el historial que ve la IA excluye lo anterior a esta
--     marca. El dato histórico NO se borra.
--
-- Solo cambios ADITIVOS (regla de la spec): el código viejo corre intacto
-- contra este esquema durante el deploy.
-- ============================================================================

create table if not exists event_log (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references tenants(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  kind            text not null,            -- 'assistant_error' | 'tool_trace' | 'queue_failure'
                                            -- | 'escalation_auto' | 'notify_failure' | 'backup'
  severity        text not null default 'info',  -- 'info' | 'warning' | 'error'
  detail          jsonb,                    -- traza de herramientas, mensaje de error, metadatos.
                                            -- NUNCA tokens, claves ni datos sensibles en claro.
  created_at      timestamptz not null default now()
);
create index if not exists event_log_tenant_created_idx on event_log (tenant_id, created_at desc);
create index if not exists event_log_kind_idx on event_log (kind, created_at desc);

alter table event_log enable row level security;
revoke all on table event_log from anon, authenticated;

-- Correo de notificaciones del equipo del cliente.
alter table tenants add column if not exists notification_email text;

-- Conversaciones de prueba (probador del /admin) fuera de métricas y CRM.
alter table conversations add column if not exists is_test boolean not null default false;

-- Marca de cierre: corte de la ventana de historial al reactivar.
alter table conversations add column if not exists closed_at timestamptz;
