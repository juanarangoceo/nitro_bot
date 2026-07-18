-- 0030: «Pasar a Tickets» con destinatario. El equipo elige a qué usuario va
-- el ticket o lo deja general (assigned_to NULL = rigen las etiquetas de
-- 0024). Un ticket asignado lo ve SOLO el usuario asignado (+ el admin del
-- tenant) — impuesto en la DB, no solo en la UI; Realtime respeta el SELECT.
-- FK compuesta (patrón 0021): imposible asignar a un usuario de otro tenant;
-- si el usuario se elimina, el ticket vuelve a general (set null solo en la
-- columna asignada — PG 15+).
--
-- OJO: la columna assigned_to YA existe en la DB viva desde el esquema
-- original (FK simple a app_users(id), sin on delete, jamás usada por el
-- código — 0 filas la referencian). Se conserva la columna y se reemplaza la
-- FK por la compuesta.

alter table tickets add column if not exists assigned_to uuid;
alter table tickets drop constraint if exists tickets_assigned_to_fkey;
alter table tickets add constraint tickets_assigned_to_fkey
  foreign key (assigned_to, tenant_id) references app_users(id, tenant_id)
  on delete set null (assigned_to);

create index tickets_assigned_idx on tickets(assigned_to)
  where assigned_to is not null;

drop policy if exists tickets_select on tickets;
create policy tickets_select on tickets
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'admin'
      or assigned_to = auth.uid()
      or (
        assigned_to is null
        and (
          label_id is null
          or label_id in (
            select label_id from public.app_user_labels where user_id = auth.uid()
          )
        )
      )
    )
  );
