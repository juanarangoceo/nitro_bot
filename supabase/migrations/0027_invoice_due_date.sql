-- 0027: fecha de vencimiento por factura (pedido de Juan 2026-07-17).
-- Cada factura muestra su corte/vencimiento tanto en /admin como en el módulo
-- Plan del cliente: la renovación vence en la fecha de corte del tenant (el
-- próximo ciclo que cubre); el adicional vence a los ADDON_PENDING_DAYS (15)
-- días de generarse (la misma ventana que pausa el bot si sigue pendiente).

alter table invoices add column if not exists due_date date;
