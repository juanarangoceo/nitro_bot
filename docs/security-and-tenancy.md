# Seguridad y multitenancy

## Reglas no negociables

1. Toda tabla de negocio incluye `tenant_id`.
2. RLS se habilita al crear la tabla.
3. Toda consulta con `service_role` filtra explícitamente el tenant.
4. `tenant_secrets` nunca llega al navegador o dashboard.
5. Credenciales AES-256-GCM, descifradas solo en servidor.
6. Webhooks firmados sobre body crudo antes de parsear.
7. Mensajes Meta idempotentes por `wa_message_id`.
8. Contador de consumo atómico.
9. Gemini no fija precios, envío ni totales.
10. Los cambios se prueban primero con Meta y Shopify dev.

## Contextos de datos

`lib/supabase/server.ts` usa anon key y cookies; PostgreSQL aplica RLS mediante `current_tenant_id()`. Es el contexto de `/dashboard`.

`lib/supabase/admin.ts` usa `service_role` e ignora RLS. Solo se usa server-side para webhooks, workers, sync, provisión y plataforma. `/admin` verifica `platform_admins` en cada entrada y Server Action. `proxy.ts` no es autorización suficiente.

## Checklist para tablas

- `tenant_id`, FK e índice.
- RLS, políticas, grants y revokes en la misma migración.
- Tenant en claves únicas relevantes.
- Cascadas y conservación histórica revisadas.
- Prueba de lectura y mutación cruzada entre tenants.
- Secretos invisibles para `authenticated`.

No se versionan secretos, teléfonos, nombres o tokens. `.env.local` permanece ignorado y `NEXT_PUBLIC_*` solo contiene valores seguros para navegador.
