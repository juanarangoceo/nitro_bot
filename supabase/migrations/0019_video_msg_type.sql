-- Migración #19 — soporte de VIDEO entrante: messages.msg_type admite 'video'.
-- Nota: en la DB en vivo el CHECK de msg_type no existe (0001_init.sql se editó
-- después de aplicado), así que el DROP IF EXISTS cubre ambos casos y el ADD
-- deja el constraint normalizado en cualquier despliegue.

alter table public.messages
  drop constraint if exists messages_msg_type_check;

alter table public.messages
  add constraint messages_msg_type_check
  check (msg_type in ('text', 'audio', 'image', 'video', 'other'));
