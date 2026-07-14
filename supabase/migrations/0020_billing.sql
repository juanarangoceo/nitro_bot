-- Migración #20 — Plan y facturación por tenant.
-- El valor de la mensualidad ya existe (tenants.monthly_fee, migración #8).
-- Aquí se agregan la fecha de corte, el estado del pago y el precio del
-- paquete adicional de mensajes. billing_status default 'pagado' para no
-- mostrar "factura pendiente" a los clientes existentes hasta que el admin
-- configure su facturación.

alter table tenants add column if not exists billing_due_date date;
alter table tenants add column if not exists billing_status text not null default 'pagado'
  check (billing_status in ('pagado', 'pendiente'));
alter table tenants add column if not exists addon_price numeric;  -- paquete adicional (COP)
