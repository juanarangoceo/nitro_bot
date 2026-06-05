-- ============================================================================
-- Migración #4: guardar el variant id por defecto del producto.
-- Necesario para crear órdenes en Shopify (las líneas de pedido usan variantId).
-- ============================================================================

alter table products add column if not exists shopify_variant_id text;
