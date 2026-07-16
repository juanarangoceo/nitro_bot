-- 0024: Visibilidad ESTRICTA de tickets por etiqueta, impuesta en la base.
-- Regla de negocio (decidida 2026-07-16): el admin del tenant ve todos los
-- tickets; un agente ve SOLO los de sus etiquetas (app_user_labels) + los
-- tickets sin etiqueta («Sin etiqueta», visibles para todo el equipo). Un
-- agente sin etiquetas asignadas ve únicamente los sin etiqueta (antes veía
-- todo — ese opt-in se invierte aquí).
--
-- Se separa la policy tenant_isolation (FOR ALL) por verbo: el SELECT lleva
-- la regla de etiquetas; escrituras siguen siendo solo aislamiento por tenant
-- (los agentes resuelven tickets que ven; «Pasar a Tickets» inserta sin
-- etiqueta). El worker y los escalados usan service_role (RLS no aplica).
-- Realtime respeta el SELECT: un agente solo recibe eventos de sus tickets.

drop policy if exists tenant_isolation on tickets;

create policy tickets_select on tickets
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'admin'
      or label_id is null
      or label_id in (
        select label_id from public.app_user_labels where user_id = auth.uid()
      )
    )
  );

create policy tickets_insert on tickets
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()));

create policy tickets_update on tickets
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

create policy tickets_delete on tickets
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()));
