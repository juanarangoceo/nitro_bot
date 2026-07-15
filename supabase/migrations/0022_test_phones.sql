-- 0022: Números de prueba por tenant. Un mensaje de WhatsApp desde uno de
-- estos números marca su conversación como is_test: el worker NO descuenta
-- del contador (ni dispara alertas de créditos) y el dashboard del cliente la
-- muestra con el badge «Prueba». Métricas/CRM/recordatorios ya excluían
-- is_test. Se edita desde /admin (no es secreto).

alter table tenants add column if not exists test_phones jsonb not null default '[]';
