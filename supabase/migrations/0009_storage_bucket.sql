-- ============================================================================
-- Nitro Bot — Migración #9: bucket privado de media de WhatsApp
-- ----------------------------------------------------------------------------
-- Bucket PRIVADO `wa-media` para guardar audio/imágenes entrantes (del cliente)
-- y salientes (que envía el agente desde el panel). El navegador NUNCA accede
-- directo: un Route Handler firma URLs server-side con service_role.
-- Convención de ruta: {tenant_id}/{conversation_id}/{message_id}.{ext}
-- Idempotente.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('wa-media', 'wa-media', false)
on conflict (id) do nothing;
