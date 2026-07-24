# Arquitectura

Nitro Bot es un monolito modular multi-tenant. Un despliegue atiende varias tiendas, pero cada operación se resuelve dentro de un tenant. Next.js entrega interfaz y endpoints; Supabase concentra datos y autorización; Gemini ejecuta el asesor mediante herramientas controladas; Meta y Shopify son los canales externos principales.

```text
WhatsApp -> webhook Meta -> after()/cola -> worker -> Gemini
                                                |-> RAG/pgvector
                                                |-> Shopify
                                                |-> WhatsApp media
                                                `-> tickets humanos

Shopify -> webhook Shopify -> catálogo/checkouts
Usuario -> Next.js -> dashboard con RLS -> Supabase
Operador -> Next.js -> panel de plataforma -> service_role
```

## Superficies

- `app/dashboard/`: panel del cliente con sesión y RLS.
- `app/admin/`: panel transversal; exige `platform_admins` y usa `service_role` en servidor.
- `app/api/webhooks/`: entradas firmadas de Meta y Shopify.
- `app/api/cron/`: tareas protegidas por `CRON_SECRET`.
- `app/api/shopify/oauth/`: conexión OAuth.
- `app/r/`: redirects públicos de carritos.
- `proxy.ts`: refresco de sesión y redirect optimista; no reemplaza autorización ni RLS.

El proyecto usa Next.js 16. Antes de escribir código se lee la guía relevante en `node_modules/next/dist/docs/`, como exige `AGENTS.md`.

## Dominios

`app/` contiene páginas, layouts, Route Handlers y Server Actions. `lib/` contiene lógica reusable: `ai`, `shopify`, `whatsapp`, `carts`, `provisioning`, `billing-cycle`, `tickets`, `support`, `notify`, `ops` y `audio`.

## Flujo de WhatsApp

1. Meta envía el body y el webhook verifica la firma cruda.
2. Se programa el trabajo después de responder HTTP 200.
3. El worker resuelve tenant y secretos, blocklist e idempotencia.
4. Persiste, hace debounce y valida estado y consumo.
5. Gemini ejecuta solo herramientas server-side.
6. La respuesta se guarda y envía; los fallos escalan a humano.

Gemini nunca es fuente de verdad comercial: precios, disponibilidad, envío y totales se calculan en servidor.

## Decisiones vigentes

- Órdenes contraentrega (`PENDING` en Shopify).
- RAG de 768 dimensiones con HNSW.
- Debounce aproximado de ocho segundos.
- `after()` detrás de `lib/queue.ts`; evolución prevista a cola durable.
- Medios WhatsApp privados y branding público por tenant.
