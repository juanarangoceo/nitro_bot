-- ============================================================================
-- Nitro Bot — Migración #13: galería de imágenes de producto
--
-- El bot podía enviar solo la foto principal (products.image_url). Para que
-- pueda entregar más fotos cuando el cliente lo pida, guardamos la galería
-- completa de Shopify (ordenada, la principal de primera). Solo ADITIVO:
-- image_url se conserva como la foto principal.
-- ============================================================================

alter table products add column if not exists image_urls jsonb not null default '[]'::jsonb;
