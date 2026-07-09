-- Información fija de la empresa (envíos, garantías, devoluciones, horarios),
-- separada del prompt de identidad. Se inyecta como sección propia del system
-- prompt y se edita desde /admin. Solo lectura vía service_role (select("*")),
-- sin cambios de RLS.
alter table tenants add column if not exists business_info text;
