-- 0031: suspensión MANUAL del servicio por pago (palanca de cobro).
-- Decisión 2026-07-19: la pausa por falta de pago deja de ser automática
-- (agotar el ciclo entra en "modo gracia": el bot sigue respondiendo) y el
-- corte pasa a ser un botón en /admin. `service_paused` es independiente de
-- `is_active` (pausar cliente apaga el tenant completo): suspendido, el bot
-- calla SIN consumir mensajes, pero webhooks, dashboard y catálogo siguen
-- vivos. Solo lo escribe service_role (/admin); el cliente lo LEE para el
-- banner de suspensión de su dashboard.
alter table tenants
  add column if not exists service_paused boolean not null default false;
