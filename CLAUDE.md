@AGENTS.md

# Nitro Bot

SaaS **multi-tenant** que automatiza ventas y atención por **WhatsApp con IA** para
tiendas e-commerce. Un solo despliegue atiende a muchas tiendas (*tenants*) con
datos 100% aislados. Empresa: Nitro Ecom (Juan Arango). **Cliente Cero: Elegance
Colombia**. Modelo SaaS privado, venta directa, ~$450.000 COP/mes por tienda.

El asesor responde por WhatsApp, busca en el catálogo real (RAG), recomienda y
**cierra ventas creando la orden en Shopify**. Cada tienda tiene un dashboard para
ver consumo, atender tickets escalados, métricas, CRM y editar el comportamiento
del asesor.

> Documentos fuente (propuesta) en Google Drive: `openclaw/nitro_bot_archivos`
> (Fundacional, Estrategia, Tecnología, Spec-Claude-Code).

---

## Reglas NO negociables

1. **Multi-tenant real**: toda tabla de negocio lleva `tenant_id`. Un solo despliegue.
2. **RLS desde la migración #1** (ya hecho). Una fuga entre tenants es el peor fallo.
3. **Webhook de Meta responde 200 OK < 1s**; la IA se procesa fuera del request.
4. **Idempotencia** por `wa_message_id` (Meta reenvía eventos).
5. **HMAC** en Shopify (sobre body crudo) + **verify token Y firma `X-Hub-Signature-256`** en Meta.
6. **Contador de consumo atómico** + reseteo mensual + alerta al 80%.
7. **Dev-first**: todo contra número de prueba de Meta y tienda Shopify dev antes de tocar cuentas reales.
8. **Credenciales por tenant cifradas** (AES-256-GCM), solo server-side, jamás al navegador.
9. **La IA nunca fija precios/totales**: se calculan server-side desde el catálogo (anti prompt-injection).

## Decisiones de arquitectura tomadas

- **Cola de IA**: `after()`/`waitUntil` de Next.js ahora; handler de procesamiento
  aislado para migrar a **QStash** después (reintentos/dead-letter).
- **Pago de órdenes**: **Contraentrega (COD)** — dominante en Colombia.
- **Multimodal completo** desde el MVP: transcripción de notas de voz + imágenes.
- **Debounce ~6-10s** de mensajes entrantes para coalescer ráfagas (Fase 3).
- Índice vectorial **HNSW** (no ivfflat). `tenant_id` vía helper `current_tenant_id()` en RLS.
- **Modelo de chat: `gemini-3.5-flash`** con `thinkingLevel: "low"`. Flash-Lite
  resultó inconsistente disparando herramientas (~3/5); 3.5 Flash es 5/5 fiable.
  Gemini 3.x: NO enviar `temperature`; `functionResponse` debe incluir el `id`
  del `functionCall` (name y conteo coincidentes) o el modelo responde vacío.

## Stack

Next.js 16 (App Router) + TS + Tailwind · Supabase (Postgres, pgvector, Realtime,
Auth) · Meta Cloud API · Gemini 3.5 Flash (`gemini-3.5-flash`, chat) +
`gemini-embedding-001` (768d), vía REST con `fetch` · Shopify (GraphQL Admin API
`2026-04`, webhooks) · Deploy: Vercel + Supabase.

---

## ESTADO ACTUAL — dónde vamos

### ✅ Hecho y verificado
- **Fundaciones**: scaffold Next.js, git, `.env.local` (gitignored), runner de migraciones.
- **Migración #1** (`supabase/migrations/0001_init.sql`): esquema multi-tenant,
  RLS en todas las tablas, `tenant_secrets` solo-servidor, índice HNSW, funciones
  `current_tenant_id()`, `match_products()`, `increment_message_counter()`.
- **Migración #2** (`0002_grants.sql`): grants de Supabase (fix `service_role`).
- **Fase 1 — Catálogo Shopify → Supabase**: resolución de tenant, cliente Shopify,
  embeddings Gemini, sync (webhook + backfill), webhook con HMAC. Tenant **Elegance
  (dev)** sembrado (id `c3a2bcc9-1757-4f7a-992d-c9761c01361d`). **17 productos con
  embedding**; RAG `match_products` verificado (consulta en español encuentra
  catálogo en inglés). Typecheck limpio.
- **Fase 2 — Cerebro IA**: RAG (`lib/ai/rag.ts`), prompt por tenant
  (`lib/ai/prompt.ts`), function calling (`lib/ai/tools.ts`), cliente Gemini con
  loop + multimodal (`lib/ai/gemini.ts`), endpoint interno `/api/dev/chat`.
  **Verificado**: tool-calling 3/3 fiable citando productos reales; escalamiento
  y cierre de orden (multi-turn) OK; el total lo calcula el servidor (anti
  prompt-injection). Migración #3 fijó el modelo a `gemini-3.5-flash`.
- **Fase 4 — Cierre de ventas (COD)**: `lib/shopify/orders.ts` crea la orden REAL
  en Shopify con la mutación **`orderCreate`** (scope `write_orders`; la app NO
  tiene `write_draft_orders`) y `financialStatus: PENDING` (= contraentrega).
  Migración #4 agregó `products.shopify_variant_id` (las líneas usan variantId).
  **Verificado**: orden **#1001** creada en Shopify dev (PENDING, trazable en
  `orders` y `customers`). Robustez: teléfono normalizado a E.164 (+57) y se
  exige dirección antes de crear. El total/precios salen del catálogo, no de la IA.

- **Fase 3 — WhatsApp (verificada en vivo en producción)**: webhook Meta
  `app/api/webhooks/meta/route.ts` (GET handshake con `META_VERIFY_TOKEN`; POST
  valida `X-Hub-Signature-256` sobre body crudo con `META_APP_SECRET`, responde
  200 OK <1s y encola con `after()`). `lib/queue.ts` (abstracción de cola sobre
  `after()`, migrable a QStash). `lib/whatsapp/meta.ts` (Cloud API `v23.0`:
  `sendText`, `markAsRead`, `downloadMedia` multimodal, parsing del payload).
  `lib/ai/worker.ts` (idempotencia por `wa_message_id` vía upsert ignoreDuplicates,
  debounce ~8s con "último mensaje gana", gate por `conversations.status`,
  `increment_message_counter` + corte al límite, historial → `runAssistant`, media
  inline a Gemini). La resolución de tenant + descifrado van en el trabajo de fondo
  (no en el request). `maxDuration=60` en la ruta. **Desplegado en Vercel** (repo
  `github.com/juanarangoceo/nitro_bot`, env vars de runtime cargadas); webhook de
  Meta registrado y suscrito a `messages`. **Verificado**: mensaje real → respuesta
  del asesor. Tenant Elegance con `wa_phone_number_id` y `wa_access_token` cifrado
  (vía `npm run seed:wa`).

### 🔜 Pendiente
- **Registrar webhooks de Shopify** (sync incremental en vivo) — ya hay URL pública
  (Vercel): falta registrar los topics `products/*` apuntando a
  `/api/webhooks/shopify`. El backfill ya cubre la carga inicial.
- **Fase 5 — Dashboard**: Auth, consumo, tickets Realtime, métricas, CRM, editor.
- **Fase 6 — Pruebas y activación**: e2e, tests de fuga RLS, observabilidad, cron de reseteo, migrar Elegance a producción.

> Plan completo: `~/.claude/plans/splendid-cuddling-candy.md`.

---

## Estructura del código

```
app/api/webhooks/shopify/route.ts   webhook catálogo (HMAC + after())
app/api/webhooks/meta/route.ts      webhook WhatsApp (handshake + firma + encola)
app/api/dev/chat/route.ts           endpoint interno de prueba del asesor (dev)
lib/queue.ts                        cola de fondo (after() hoy, QStash después)
lib/whatsapp/meta.ts                Cloud API: enviar/leer/descargar media + parsing
lib/ai/worker.ts                    procesa entrante (idempotencia/debounce/gate/IA)
lib/env.ts                          acceso a env server-side (lazy)
lib/crypto.ts                       AES-256-GCM de credenciales por tenant
lib/tenant.ts                       resuelve tenant + descifra secretos
lib/supabase/admin.ts               cliente service_role (ignora RLS)
lib/ai/embeddings.ts                Gemini embeddings (768d) vía REST
lib/ai/rag.ts                       búsqueda semántica (embed query + match_products)
lib/ai/prompt.ts                    system prompt por tenant + reglas operativas
lib/ai/tools.ts                     function calling (precio/total server-side)
lib/ai/gemini.ts                    cliente gemini-3.5-flash + loop de tools
lib/shopify/client.ts               GraphQL Admin API por tenant
lib/shopify/sync.ts                 sync de catálogo (webhook + backfill)
lib/shopify/orders.ts               crea orden COD (orderCreate, PENDING)
scripts/migrate.mjs                 runner de migraciones (pg directo)
scripts/seed-tenant.ts              alta de tenant con creds cifradas (tsx)
scripts/seed-wa.ts                  carga creds WhatsApp del tenant (token cifrado)
scripts/backfill-catalog.ts         carga inicial del catálogo (tsx)
supabase/migrations/*.sql           esquema + RLS + grants
```

## Comandos

```bash
npm run dev                 # Next dev
npm run migrate             # aplica migraciones pendientes
npm run migrate:status      # estado de migraciones
SEED_SHOP_DOMAIN=... SEED_SHOP_TOKEN=... SEED_SHOP_SECRET=... npm run seed:tenant
SEED_WA_PHONE_NUMBER_ID=... SEED_WA_TOKEN=... npm run seed:wa
SEED_SHOP_DOMAIN=... npm run backfill:catalog
npx tsc --noEmit            # typecheck
```

## Conexión a Supabase / convenciones

- Proyecto Supabase ref `snbxdzytpwibctepuiwq` (cuenta distinta a la del MCP — el
  MCP no lo ve). **Migraciones usan conexión DIRECTA** `db.<ref>.supabase.co:5432`
  user `postgres` (el pooler daba auth-fail tras el reset; reintentar para Vercel).
- La password de la DB tiene un `@` → usamos **vars discretas** en `.env.local`
  (`SUPABASE_DB_HOST/PORT/USER/PASSWORD/NAME`), no una connection string.
- Identificadores de código/tablas/env en inglés `snake_case`. Mensajes del asesor
  y UI en **español (Colombia)**, tono configurable por tenant.
- Nada de secretos en el repo: todo en `.env.local` (gitignored) o cifrado en DB.
- Credenciales por fase: Shopify dev ✅, Gemini ✅ y Meta/WhatsApp (número de prueba) ✅ cargadas.
- Next.js 16 tiene breaking changes (ver `AGENTS.md`): consultar `node_modules/next/dist/docs/` antes de escribir código de Next.
