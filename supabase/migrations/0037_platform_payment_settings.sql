-- ============================================================================
-- Nitro Bot — Migración #37: datos de pago globales de la plataforma
--
-- Los números que ven los administradores de tenant en /dashboard/plan dejan
-- de estar hardcodeados. Son configuración GLOBAL de Nitro, no datos por
-- tenant. Solo service_role puede leer/escribir; el dashboard los obtiene
-- mediante un Server Component, sin exponer acceso a la tabla.
-- ============================================================================

create table if not exists platform_settings (
  key             text primary key,
  payment_holder  text not null,
  payment_methods jsonb not null default '[]'::jsonb,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references platform_admins(id) on delete set null,
  constraint platform_settings_payment_methods_array
    check (jsonb_typeof(payment_methods) = 'array')
);

alter table platform_settings enable row level security;
revoke all on table platform_settings from anon, authenticated;

-- Compatibilidad: al aplicar la migración los clientes siguen viendo
-- exactamente los datos que estaban hardcodeados.
insert into platform_settings (key, payment_holder, payment_methods)
values (
  'billing',
  'Juan Arango · C.C. 1.088.018.943',
  '[
    {"label":"Nequi / Llave","value":"314 668 1896"},
    {"label":"Davivienda · Cuenta de ahorros","value":"4884 4795 4865"}
  ]'::jsonb
)
on conflict (key) do nothing;
