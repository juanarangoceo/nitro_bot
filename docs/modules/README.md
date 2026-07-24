# Índice de módulos

| Módulo | Implementación |
| --- | --- |
| Asesor IA | `lib/ai/` |
| WhatsApp | `app/api/webhooks/meta/`, `lib/whatsapp/` |
| Shopify | `app/api/webhooks/shopify/`, `app/api/shopify/`, `lib/shopify/` |
| Dashboard | `app/dashboard/`, `lib/dashboard/` |
| Plataforma | `app/admin/`, `lib/admin/`, `lib/provisioning/` |
| Carritos | `app/dashboard/carts/`, `lib/carts/` |
| Facturación | `lib/billing.ts`, `lib/billing-cycle.ts` |
| Facturas y comprobantes | `app/dashboard/plan/`, bucket `payment-proofs` |
| ROAS e inversión | `app/dashboard/metrics/`, `marketing_investments` |
| Datos de pago | `app/admin/settings/payments/`, `lib/platform/payment-settings.ts` |
| Tickets | `app/dashboard/tickets/`, `lib/tickets/` |
| Solicitudes | `app/dashboard/requests/`, `app/admin/requests/`, `lib/support/` |
| Persistencia | `lib/supabase/`, `lib/storage.ts`, `supabase/migrations/` |
| Operación | `lib/ops/`, health y crons |

Un módulo nuevo declara tenant y roles, datos y RLS, entradas, dependencias, idempotencia, telemetría, feature flag, pruebas y rollback.
