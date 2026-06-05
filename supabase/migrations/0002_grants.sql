-- ============================================================================
-- Migración #2: GRANTs para los roles de Supabase.
-- Al crear tablas por conexión directa como `postgres`, los roles anon/
-- authenticated/service_role NO reciben los privilegios de DML. Este es el
-- modelo estándar de Supabase: se otorgan privilegios de tabla a esos roles y
-- la seguridad real la da RLS (filtra filas). service_role además ignora RLS.
-- ============================================================================

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- Que las tablas/funciones futuras (creadas por postgres en migraciones) hereden
-- estos privilegios automáticamente.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- Defensa en profundidad: las credenciales por tenant son SOLO para service_role.
-- (Ya están protegidas por RLS sin políticas; esto quita además el grant.)
revoke all on table tenant_secrets from anon, authenticated;
