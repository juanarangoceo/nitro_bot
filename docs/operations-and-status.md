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

## Implementación reciente

- Datos de pago globales desplegados en `/admin/settings/payments`.
- La migración `0037_platform_payment_settings.sql` está aplicada y los
  permisos fueron verificados. Queda como control opcional una prueba visual
  cambiando y restaurando un valor desde el panel.
- Facturas vencidas, comprobantes por Telegram e inversión/ROAS están
  migrados y desplegados. Health, RLS y envío técnico de Telegram verificados;
  queda el control visual con sesión real.
