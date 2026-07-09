-- ============================================================================
-- Nitro Bot — Migración #12: branding por tenant (logo + color de acento)
--
-- El super-admin personaliza el dashboard de cada cliente desde /admin:
-- un logo y UN color de acento. Solo cambios ADITIVOS.
--
--   * tenants.logo_url    — URL pública del logo en el bucket `branding`.
--   * tenants.brand_color — hex #rrggbb; null = paleta neutral por defecto.
--   * bucket `branding` PÚBLICO: un logo no es sensible y la URL pública evita
--     firmar en cada carga del dashboard (wa-media sigue privado).
-- ============================================================================

alter table tenants add column if not exists logo_url text;
alter table tenants add column if not exists brand_color text; -- hex #rrggbb

insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;
