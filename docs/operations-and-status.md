# Operaciones y estado

Actualizado documentalmente: 2026-07-24.

## Cron

| Ruta | Frecuencia |
| --- | --- |
| `/api/cron/reset-counters` | Día 1, 05:00 UTC |
| `/api/cron/reminders` | Cada hora |
| `/api/cron/billing` | Diario, 11:00 UTC |
| `/api/cron/cart-reminders` | Cada 15 minutos |

Todos validan `CRON_SECRET` y deben tolerar reejecución.

## Observabilidad

- `/api/health`: aplicación y DB.
- `/admin/health`: eventos y uso.
- `event_log`: fallos, entrega, IA, notificaciones y tools.
- `audit_log`: acciones de plataforma.
- Vercel: requests y tareas posteriores.

HTTP 200 del webhook confirma recepción, no finalización del trabajo.

## Diagnóstico: bot sin respuesta

1. Confirmar mensaje `sender=customer`.
2. Buscar respuesta `sender=bot` posterior.
3. Revisar estado, blocklist, pausa y ciclo.
4. Revisar idempotencia y debounce.
5. Consultar `event_log`, `/admin/health` y Vercel.
6. Revisar respuesta vacía o agotamiento de Gemini.
7. Revisar entrega final en WhatsApp.

## Estado

El producto está desplegado y atiende clientes. Están construidos WhatsApp, Gemini/RAG, Shopify, dashboard, plataforma, facturación, notificaciones, multimedia, tickets, solicitudes, carritos y blocklist.

La cronología detallada permanece en `CLAUDE.md`. Ante discrepancias, verificar código, migraciones, Git, Vercel y Supabase.

Deuda visible: `after()` no es una cola durable; `lib/ai/worker.ts` concentra responsabilidades; `service_role` exige filtros explícitos; falta una suite automatizada más amplia.

## Trabajo local pendiente de activación

- Datos de pago globales editables desde `/admin/settings/payments`.
- La migración `0037_platform_payment_settings.sql` ya está aplicada; falta
  verificar el flujo visual con un tenant de desarrollo antes del despliegue.
