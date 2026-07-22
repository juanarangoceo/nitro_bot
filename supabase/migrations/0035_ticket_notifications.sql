-- 0035: Notificaciones in-app de tickets. Cuando el cliente final reescribe
-- en una conversación escalada, el worker marca el ticket abierto
-- (last_customer_message_at + has_unread) y el Realtime de tickets ya
-- existente refresca la lista y el badge del sidebar. Abrir el ticket en el
-- dashboard lo limpia (markTicketRead). has_unread es GLOBAL por ticket (no
-- por usuario): la visibilidad de 0024/0030 ya acota quién ve cada ticket.
-- default TRUE: un ticket recién escalado nace "sin leer".

alter table tickets add column if not exists last_customer_message_at timestamptz;
alter table tickets add column if not exists has_unread boolean not null default true;

-- Los tickets ya existentes no deben encender el badge en el deploy.
update tickets set has_unread = false;

-- Badge del sidebar: count de abiertos sin leer (RLS filtra por rol).
create index if not exists tickets_unread_idx
  on tickets (tenant_id) where status = 'open' and has_unread;
