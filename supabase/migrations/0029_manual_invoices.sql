-- 0029: Facturas manuales (cobros puntuales: implementaciones, desarrollos,
-- ajustes). Juan las crea desde /admin (descripción, valor, vencimiento
-- opcional) y el cliente las ve en su módulo Plan (el SELECT por RLS de 0026
-- ya las cubre). Son independientes del ciclo de mensajes: NO pausan el bot,
-- NO tocan el contador y «Marcar pagada» solo registra el pago (en
-- lib/billing-cycle todo lo que no es 'renovacion' es inofensivo).

alter table invoices drop constraint invoices_concept_check;
alter table invoices add constraint invoices_concept_check
  check (concept in ('renovacion','adicional','manual'));

-- Las manuales no pertenecen a un ciclo: cycle_start pasa a ser opcional.
-- El unique index invoices_cycle_key no choca (NULL ≠ NULL) — la idempotencia
-- por ciclo sigue intacta para renovación/adicional.
alter table invoices alter column cycle_start drop not null;

-- Nombre visible de la factura (lo usan las manuales; las automáticas siguen
-- derivando su etiqueta del concept).
alter table invoices add column if not exists description text;
