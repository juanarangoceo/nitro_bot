-- ============================================================================
-- Nitro Bot — Migración #32: videos de producto
--
-- El bot podrá enviar el video del producto por WhatsApp cuando el cliente lo
-- pida. La tienda sube el video a la galería del producto en Shopify (media
-- nativa); el sync guarda aquí las URLs MP4 del CDN de Shopify que caben en
-- los 16 MB de WhatsApp (Shopify transcodifica a varias resoluciones H.264 y
-- se elige la mejor que quepa). Solo ADITIVO, patrón de image_urls (0013).
-- ============================================================================

alter table products add column if not exists video_urls jsonb not null default '[]'::jsonb;
