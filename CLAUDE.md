@AGENTS.md

# Nitro Bot
> **Mapa documental:** este archivo conserva la bitácora y decisiones históricas. Para contexto estable empieza por [README.md](README.md), [arquitectura](docs/architecture.md), [seguridad](docs/security-and-tenancy.md), [desarrollo y despliegue](docs/development-and-deployment.md) y [operaciones](docs/operations-and-status.md). Ante discrepancias, código, migraciones y servicios verificados son la autoridad.


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
- **Modelo de chat: `gemini-3.5-flash`** con `thinkingLevel: "low"` en el asesor.
  Flash-Lite resultó inconsistente disparando herramientas (~3/5); 3.5 Flash es
  5/5 fiable. OJO: `thinkingBudget: 0` SÍ es válido en 3.5-flash vía v1beta
  (verificado 2026-07-12; la creencia "en 3.x no se puede apagar" era falsa) —
  se usa en los reminders (sin tools, no necesitan razonar); el asesor con
  tools conserva `low`.
  Gemini 3.x: NO enviar `temperature`; `functionResponse` debe incluir el `id`
  del `functionCall` (name y conteo coincidentes) o el modelo responde vacío.
  **El `contents` debe terminar en turno del cliente (`role: "user"`)**: si la
  conversación termina en un turno del modelo, Gemini devuelve texto vacío
  (`finishReason STOP`, 0 tokens de salida). Por eso la ventana de historial toma
  los N **más recientes** (`ascending: false` + `limit`, luego `reverse()`), nunca
  los más viejos: con `ascending: true + limit` la ventana se clavaba en los
  primeros mensajes al pasar de N y el bot dejaba de responder en silencio.

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

- **Webhooks de Shopify (registrados y verificados)**: topics `products/create`,
  `products/update`, `products/delete` apuntando a
  `https://nitro-bot-coral.vercel.app/api/webhooks/shopify` (vía
  `npm run register:shopify-webhooks`, idempotente). **Verificado** con un webhook
  sintético firmado contra el endpoint en vivo: HTTP 200 + re-sync (cambió
  `updated_at`). El stock se mantiene al día porque cada `products/update`
  re-sincroniza el producto completo (incluye `totalInventory`).

- **Fase 5 — Dashboard (construido y verificado)**: Auth con Supabase
  (`@supabase/ssr`), clientes SSR `lib/supabase/server.ts` (RLS, authenticated) y
  `lib/supabase/client.ts` (navegador, Realtime). `proxy.ts` (Next 16; refresca
  sesión + protege `/dashboard`). Login (`app/login`) + Server Actions
  (`app/actions/auth.ts`). Layout protegido con nav por `tenants.modules`
  (`lib/dashboard/context.ts` resuelve usuario→tenant vía RLS). Vistas: **Inicio**
  (consumo del mes con alerta al 80%), **Métricas**, **CRM** + export CSV
  (`/dashboard/crm/export`), **Tickets** en vivo (Realtime: lista +
  conversación; responder por WhatsApp pasa a `human_active`; resolver vuelve a
  `bot_active`). El **editor del asesor se movió a `/admin`** (v2): el cliente
  ya NO edita su prompt. Migración #5 habilitó Realtime (respeta RLS) en
  `tickets`/`messages`/`conversations`. Usuarios del dashboard vía
  `npm run seed:dashboard-user`. **Verificado**: sign-in OK; **RLS aísla** (un
  usuario solo ve su tenant); `tenant_secrets` invisible para `authenticated` (sin
  fuga); proxy redirige `/dashboard`→`/login` sin sesión. Faltan: `NEXT_PUBLIC_*`
  de Supabase en Vercel para el dashboard en producción.

- **Fase 6 — Pruebas y activación (en gran parte hecha)**: **cron de reseteo
  mensual** del contador (`/api/cron/reset-counters`, protegido por `CRON_SECRET`,
  agendado en `vercel.json` el día 1 a las 05:00 UTC; migración #6 agregó
  `reset_stale_message_counters()` — el reseteo perezoso de
  `increment_message_counter` sigue siendo el respaldo). **Health check**
  `/api/health` (verifica DB). **Suite de verificación** `npm run verify`
  (read-only + test de fuga RLS con usuario desechable). **Verificado**: las 4
  comprobaciones en verde (secretos descifran, RAG devuelve productos, función de
  reseteo, RLS aísla + `tenant_secrets` oculto).

- **v2 — Panel de Plataforma + multimedia + métricas (construido, typecheck/build
  verde, `verify` 4/4)**: NO desplegado/probado en vivo aún. Detalle:
  - **Migración #8** (`0008_platform_panel.sql`): `platform_admins` y `audit_log`
    (RLS activado SIN políticas + revoke a authenticated — solo `service_role`);
    columnas en `tenants` (`plan`, `monthly_fee`, `wa_display_name`,
    `wa_profile_photo_url`); `order_items` (RLS por tenant, para productos más
    vendidos); `messages.media_path`/`media_mime`. **Migración #9**: bucket
    privado `wa-media` en Storage.
  - **`lib/provisioning/*`**: lógica de los scripts extraída a funciones
    compartidas (`upsertTenant`, `runBackfill`, `registerShopifyWebhooks`,
    `seedWaCreds`, `seedDashboardUser`, `runVerify`, `provisionTenant`). Los 6
    scripts `seed:*`/`verify`/`backfill`/`register` son ahora wrappers delgados.
  - **Panel `/admin`** (super-admin, gate explícito con `service_role` en
    `lib/admin/context.ts`, NO RLS): lista de clientes con consumo/estado,
    **alta con un botón** (`provisionTenant` orquesta los 9 pasos del spec, idempotente,
    audita), detalle (editar plan/fee/límite, pausar/activar, **editar prompt aquí**,
    rotar credenciales, **suscribir WABA + configurar perfil de WhatsApp** sin tocar
    Meta, auditoría), resumen de plataforma (MRR, ventas, gasto por
    cliente). Toda acción de `/admin` re-verifica super-admin y escribe `audit_log`.
  - **Multimedia**: el bot envía fotos de producto vía herramienta
    `enviar_imagen_producto` (la IA decide); recibe audios/imágenes y los persiste
    en Storage. El agente envía fotos/audios desde Tickets (`sendMediaFromAgent`).
    Media servida al navegador vía `app/dashboard/media/[id]` (firma URLs del bucket
    privado, verifica tenant por RLS).
  - **Conversaciones en vivo (solo lectura)** en el dashboard del cliente
    (`/dashboard/conversations`, Realtime).
  - **Métricas**: "productos más vendidos" con filtro semana/mes (sobre `order_items`,
    que ahora persiste `createCodOrder`).
  - **Ruteo por rol**: tras login, super-admin → `/admin`, cliente → `/dashboard`
    (`isPlatformAdmin`). `/login` autenticado → `/` (rutea por rol). `proxy.ts`
    protege `/admin`.

- **Spec 07 — Operación y Robustez (parcial, typecheck/build/verify 4/4 verdes,
  NO probado en vivo)**: migración #10 (`event_log` solo-service_role,
  `tenants.notification_email`, `conversations.is_test` y `closed_at`).
  **A** — escalado automático: `runAssistant` señala `exhausted`; el worker, ante
  agotamiento o excepción, escala con la lógica compartida `lib/ai/escalation.ts`
  (la misma de `escalar_a_humano`), responde un mensaje resolutivo y deja la traza
  en `event_log` (`escalation_auto`/`assistant_error`). **B** — observabilidad:
  `tool_trace` por turno, `queue_failure` en `lib/queue.ts`, vista `/admin/health`
  (errores 24h, filtros, paginación), visor `/admin/conversations/[id]` con borrado
  de conversaciones de prueba, retención de event_log en el cron mensual (90d/30d
  info). **E** — contraseñas: reset desde `/admin` (temporal mostrada una vez,
  auditada) y "Mi cuenta" en el dashboard (cambio re-autenticando). **F** — cerrar
  conversación (dashboard) con `closed_at` como corte: el worker REACTIVA una
  conversación `closed` cuando el cliente escribe y el historial a Gemini excluye
  lo anterior al cierre. **G** — probador `/admin/tester` (testMode: orden simulada
  con total server-side, escalado sin ticket, fotos en la UI, sin WhatsApp ni
  contador; `is_test` fuera de métricas y de la vista del cliente).
  **Diferidas: C (alertas Telegram), D (correo Resend) y H (backup a Drive)** —
  la spec vive en Drive (`07-Nitro-Bot-Spec-Operacion-Claude-Code.md`).

- **Spec 08 — OAuth de Shopify (construida, NO probada en vivo)**: migración #11
  (`shopify_client_id`/`shopify_client_secret` en `tenant_secrets`,
  `shopify_oauth_states`). `lib/shopify/oauth.ts` (scopes en constante única,
  HMAC de query en tiempo constante, intercambio de code, `write_X` satisface
  `read_X`). Rutas `/api/shopify/oauth/start` (gate super-admin, state 32 bytes
  un solo uso/10 min) y `/callback` (pública: state→expiración→HMAC→shop exacto→
  consumo atómico→intercambio→scopes→guardar cifrado; `shopify_webhook_secret`
  pasa a ser el client secret, coherente con el HMAC del webhook; webhooks +
  backfill en segundo plano; fallos a `event_log` `oauth_failure`). En `/admin`:
  sección "Conexión Shopify (OAuth)" en el detalle; el alta acepta client_id/secret
  como alternativa al token manual (pasos Shopify quedan en ámbar "Pendiente:
  conectar"). Probar requiere `APP_BASE_URL` en Vercel y una app del Dev Dashboard
  con flujo de instalación heredado.

- **Sesión 2026-07-09 (todo DESPLEGADO en producción — primer deploy en ~29
  días, así que v2 + specs 07/08 quedaron en vivo junto con esto)**:
  - **Preflight**: env vars de Vercel confirmadas (`NEXT_PUBLIC_*`, `CRON_SECRET`,
    `APP_BASE_URL`; falta solo `META_APP_ID`, opcional). Super-admin
    `juanarangopm@gmail.com` existe desde el 2026-06-06. Repo linkeado a Vercel
    (`seller360grados-projects/nitro-bot`; CLI autenticada).
  - **Usuarios desde `/admin`** (detalle del cliente): crear usuario del
    dashboard (contraseña temporal mostrada una vez; email duplicado = error,
    jamás pisa cuentas; rollback si falla el insert) y eliminar usuario
    (protegido: nunca el último del tenant). Solo `app_users` — jamás toca
    `platform_admins`. Todo auditado.
  - **Branding por tenant** (migración #12): `tenants.logo_url`/`brand_color`
    + bucket **público** `branding`. Card "Personalización del dashboard" en
    /admin (logo máx 2 MB, color de acento). El dashboard muestra el logo en la
    sidebar y aplica el color vía var CSS `--brand` (fallback #171717 = cero
    cambio si no se configura).
  - **UX del dashboard**: paneles de Conversaciones/Tickets con altura acotada,
    scroll interno y auto-scroll al último mensaje; botón "Eliminar" conversación
    (cascade borra mensajes/tickets; órdenes sobreviven con FK null) y "Vaciar
    CRM" con confirmación (RLS: solo el propio tenant; verificado sin fuga).
  - **Galería de fotos** (migración #13): `products.image_urls` (jsonb) desde
    `media(first:10)` de la Admin API; la herramienta `enviar_imagen_producto`
    acepta `cantidad` (1-4) — la IA manda varias fotos SOLO si el cliente pide
    más ángulos (regla en el prompt). Backfill dev re-corrido: 901 productos,
    613 con galería. El tester muestra todas las fotos.
  - **Feature D HECHA — Resend** (`lib/notify/email.ts`, REST sin SDK):
    correo al equipo del cliente en (a) conversación NUEVA y (b) ticket
    escalado (enganchado en `escalateToHuman`, punto único). Campo "Correo de
    notificaciones" editable en /admin (vacío = sin avisos). Best-effort
    blindado (jamás lanza; fallos a `event_log` `notify_failure`). Envío real
    verificado. `RESEND_API_KEY`/`NOTIFY_FROM_EMAIL` en `.env.local` y Vercel;
    remitente aún `onboarding@resend.dev` (solo entrega al dueño de la cuenta
    Resend — cambiar al verificar dominio propio).
  - **Recordatorios automáticos** (migración #14): máx 2 por episodio de
    silencio, dentro de la ventana de 24h de WhatsApp — fase 1 a ~4h (Gemini
    retoma la conversación real, termina en pregunta) y fase 2 a ~22h (última:
    despedida sin presión). Exclusiones: no `bot_active`, `is_test`, último
    mensaje no-bot, orden ya creada, tenant inactivo/al límite/apagado
    (`tenants.reminders_enabled`, toggle en /admin). `lib/ai/reminders.ts` +
    cron horario `/api/cron/reminders` (CRON_SECRET) en vercel.json. El worker
    resetea `reminder_count` cuando el cliente escribe. Traza `reminder` en
    event_log. Verificado con 6 escenarios contra la DB real.
  - **Reset de contador** en /admin ("Reiniciar contador a 0", auditado) para
    entregar el cliente en cero tras las pruebas.

- **Sesión 2026-07-09 (bis) — 7 ajustes del asesor (VERIFICADOS e2e contra
  Gemini y Shopify dev; typecheck/build/verify 4/4; DESPLEGADOS en producción,
  commit c6582c4, health OK)**:
  - **Descripciones + disponibilidad (migración #15)**: `match_products` filtra
    `status='active'` (disponible = status de Shopify, NO stock — el cliente usa
    "seguir vendiendo sin inventario"). `buscar_productos` devuelve `descripcion`
    recortada (~350 chars) y `disponible`; se ELIMINÓ `ver_stock` (número crudo
    engañoso) y se creó `ver_detalle_producto` (ficha completa de un producto).
  - **`business_info` (migración #16)**: campo separado del prompt con info fija
    de la empresa (envíos/garantías/devoluciones), card propia en /admin
    (`updateBusinessInfoAdmin`, vacío = sin sección), inyectado como sección del
    system prompt con regla de "responde con ESTO y no escales por esto". OJO:
    el prompt NUNCA tuvo caché (se lee fresco por mensaje); el "responde con
    info vieja" era el historial imitándose a sí mismo → regla de precedencia
    nueva en `buildSystemPrompt`.
  - **Orden Shopify completa** (`lib/shopify/orders.ts` + `lib/shopify/colombia.ts`):
    la orden ahora asocia el **customer** (busca por teléfono con `read_customers`
    o crea con `customerCreate`; `toAssociate {id}` — `toUpsert` NO sirve: exige
    id/email). `shippingAddress` lleva `countryCode: CO` + `provinceCode` ISO
    (en 2026-04 `country`/`province` string ya no están en la introspección).
    Departamento: mapa ciudad→departamento (~60 ciudades) + arg opcional
    `departamento` en `crear_orden`; ciudad desconocida → error
    `FALTA_DEPARTAMENTO` que hace que la IA pregunte. `splitName` 2+2 con 4+
    palabras. `customers.shopify_customer_id` por fin se persiste. **Verificado
    con orden real #133910 en Shopify dev** (customer asociado + Antioquia/ANT;
    filas locales de prueba ya borradas — cancelar la orden en Shopify admin).
  - **Teléfono = mismo WhatsApp**: `telefono` opcional en `crear_orden`; si la IA
    lo omite, el server usa `ctx.customerPhone` (el número real del canal, nunca
    lo decide el modelo). Regla de cierre nueva en el prompt ("¿te contactamos a
    este mismo WhatsApp…?").
  - **Imágenes en ráfaga (fix del debounce)**: `collectTurnMedia` en el worker
    adjunta inline la media de TODOS los mensajes del cliente posteriores a la
    última respuesta del bot (cap 3, ≤5 MB c/u, `downloadWaMedia` desde Storage);
    antes solo iba el mensaje actual y una foto seguida de texto llegaba como
    "[imagen]" sin bytes. Verificado: Gemini identificó el producto de una foto
    real y lo cotizó.
  - **Escalamiento**: diagnóstico real (30d: 5 pide_humano, 4 fallo_tecnico por
    `exhausted`, 1 cancelación — el problema eran los loops de tools agotando
    5 rondas, casi todos el mismo día). Fixes: descripción de `escalar_a_humano`
    endurecida ("ÚLTIMO recurso…") + `motivo` como enum; guard server-side
    (`ctx.calledTools`): `fuera_de_catalogo` exige `buscar_productos` en el
    turno; y en `runAssistant`, al agotar `MAX_TOOL_ROUNDS`, UNA llamada final
    con `toolConfig mode NONE` para responder con lo recopilado antes de escalar.

- **Sesión 2026-07-10 — Respuestas de voz con Mistral (Voxtral TTS), premium
  por tenant (DESPLEGADO en producción, commit efb08e0, health OK)**:
  - **Arquitectura**: Gemini sigue siendo el cerebro (RAG/tools/órdenes intactos);
    Mistral SOLO hace TTS del texto que Gemini genera. Audio entrante → respuesta
    en nota de voz; texto → texto; cualquier fallo de TTS → fallback a texto (el
    cliente jamás queda sin respuesta). La CLI de Mistral ("Vibe") NO se usa: es
    un asistente de código; todo va por REST con fetch.
  - **API**: `POST https://api.mistral.ai/v1/audio/speech` (Bearer), body
    `{model: "voxtral-mini-tts-2603", input, voice_id, response_format: "opus"}`
    → JSON `{audio_data: base64}`. Opus = OGG/Opus mono 24kHz, el formato exacto
    de nota de voz de WhatsApp (verificado con `file`). Docs: <300 palabras, sin
    markdown/emojis; 403 = moderación. ~$0.016 USD/1k chars.
  - **Migración #17**: `tenants.voice_replies_enabled` (default OFF, premium) y
    `tenants.voice_id` (voz propia del cliente; NULL = voz global
    `MISTRAL_VOICE_ID`). Toggle + campo en /admin (card "Datos del cliente",
    `updateTenantCommercial`, auditado). El voice_id NO es secreto.
  - **`lib/ai/tts.ts`**: `synthesizeSpeech` best-effort (patrón email.ts): jamás
    lanza; sanitiza markdown/emojis/URLs, cap 900 chars (más largo → null →
    texto), timeout 15s, fallos a `event_log` `tts_failure`. Sin
    `MISTRAL_API_KEY` o sin voz → no-op.
  - **Worker**: `voiceTurn` = toggle on + mensaje ganador del debounce es audio +
    TTS configurado. Inyecta instrucción de concisión hablada (2-3 frases, sin
    markdown) vía param nuevo `extraSystem` de `runAssistant` (se anexa al system
    prompt del tenant → misma narrativa). Envío: `uploadMedia`+`sendAudio` (ya
    existían); persiste `msg_type: "audio"` con el TEXTO como `content` (el
    historial de Gemini y el dashboard lo ven) + copia en Storage (`media_path`).
  - **Verificado e2e real**: TTS con la voz "Elegance Support" (2.6s, 50KB OGG);
    turno completo Gemini→catálogo real→respuesta hablada 55 palabras con precios
    en letras→TTS OK; key inválida → null + traza `tts_failure`; typecheck/build/
    verify 4/4. Env vars: `MISTRAL_API_KEY` + `MISTRAL_VOICE_ID` en `.env.local`
    y Vercel Production (la voz global es "Elegance Support",
    id `65e9e29e-c8bf-49a4-8842-f5987b162ee2`; listar voces:
    `GET /v1/audio/voices`). OJO: la CLI de Vercel 54.9.1 no pudo agregar la var
    a Preview (bug del prompt de git branch) — solo falta ahí.

- **Sesión 2026-07-10 (bis) — fix envío de órdenes + medición de tokens
  (DESPLEGADOS: commits bba079e y 77ae215)**:
  - **Fix envío $15.000**: `tenants.shipping_rules` estaba VACÍO (nada lo
    escribía en todo el repo) → `crear_orden`/`calcular_envio` caían al fallback
    quemado (15000/150000) mientras el chat citaba `business_info` ($18.000 /
    gratis desde $199.000). Fix: datos de Elegance corregidos
    (`{flat_fee:18000, free_over:199000}`); campos "Costo de envío" y "Envío
    GRATIS desde" en /admin (Datos del cliente, prellenados con el valor
    efectivo); `buildSystemPrompt` inyecta los valores VIGENTES de
    shipping_rules ("son los mismos de crear_orden; prevalecen") — chat y orden
    ya no pueden divergir. Verificado: 100k→18000, 250k→gratis, orden real
    pendiente de re-ensayo del usuario.
  - **Medición de tokens Gemini** (el alza de gasto era invisible: se botaba
    `usageMetadata`): `runAssistant` acumula por turno → `AssistantResult.usage`
    (calls/prompt/output/thoughts/cached/audio); `event_log` kind `gemini_usage`
    desde worker (source whatsapp + voice), probador (tester) y recordatorios
    (reminder); sección "Tokens Gemini (14 días)" en /admin/health (por día +
    origen + top 5 conversaciones). Medido: un turno con tools = ~13k tokens de
    ENTRADA en 3 llamadas vs ~380 de salida (el input por ronda es el costo);
    audio entrante facturado aparte (636 audioTokens en la prueba). Diagnóstico
    del alza de 48h: 136 turnos de prueba + 8 loops agotados del 07-09 + audio.
  - **Audios de voz más cortos** (reporte: largos y repetitivos):
    `VOICE_TURN_INSTRUCTION` endurecida (máx 2 frases ~45 palabras, no repetir
    saludos/lo ya dicho, máx 2 productos) y cap del TTS 900→600 chars (si sale
    más largo va como TEXTO). `ver_detalle_producto` cap 1500 chars. Verificado:
    respuesta de voz en 2 frases/46 palabras entendiendo la nota de voz.

- **Sesión 2026-07-11 — Módulo «Solicitudes» (soporte asíncrono cliente ↔
  plataforma; MERGEADO a main, commit 86ad7d4)**: el tenant registra
  solicitudes (ajuste_asesor/reporte_error/sugerencia/otro) en
  `/dashboard/requests` y Juan las gestiona en `/admin/requests`. De cara al
  cliente se llama «Solicitudes», NUNCA «Tickets» (ya usado por las
  conversaciones escaladas del bot). Deliberadamente asíncrono, NO chat.
  - **Migración #18**: `support_requests` (status: nueva/en_revision/aprobada/
    en_proceso/resuelta/rechazada/cerrada_por_cliente + `eta_date` estimada +
    `rejection_note`) y `support_request_comments` (hilo). **RLS con verbos
    separados + grants POR COLUMNA**: el cliente solo inserta
    (tenant_id/created_by/category/subject/description), comenta como
    `'client'` firmando con su uid (policy lo fuerza) y cierra las propias
    (`grant update (status)` + policy `with check (status='cerrada_por_cliente')`).
    `status`/`eta_date`/`rejection_note` SOLO service_role — bloqueado a nivel
    DB, no solo UI. OJO: `0002_grants.sql` da ALL a authenticated en tablas
    nuevas (default privileges) → toda tabla con escritura restringida necesita
    REVOKE explícito.
  - **Dashboard**: nav «Solicitudes» (`mod.requests !== false`, opt-out como el
    resto), lista con badges, form de creación, detalle con hilo + «Ya no la
    necesito». El form NO menciona el editor del asesor (el cliente ya no lo
    tiene; se movió a /admin en v2).
  - **/admin**: bandeja unificada (nuevas primero, filtros estado/categoría/
    tenant), **badge ámbar con conteo de nuevas en la sidebar** (count en el
    layout server → prop a AdminSidebar), detalle con gestión (estado + eta +
    responder; rechazar EXIGE motivo). Todo con `requirePlatformAdmin()` +
    `logAudit` (`support_request_status`/`support_request_reply`).
  - **Correos (Resend)**: `notifySupportRequestStatus`/`notifySupportRequestReply`
    en `lib/notify/email.ts` (mismo patrón best-effort). Sin correo cuando el
    cambio es `cerrada_por_cliente`. Requiere `tenants.notification_email`.
  - **Observabilidad**: `event_log` kind `support_request` (info) al crear;
    `/admin/health` ahora al filtrar por un kind concreto muestra también sus
    eventos info (sin filtro sigue mostrando solo warning/error).
  - **Verificado**: typecheck/build/verify 4/4 + **15 checks RLS/grants** con
    usuario y tenant desechables (fuga entre tenants, columnas prohibidas,
    suplantación de rol/uid en comentarios, update/delete bloqueados).
    Vocabulario compartido en `lib/support/labels.ts`.

- **Sesión 2026-07-11 (bis) — Spec 10: tokens Gemini (DESPLEGADO, commit
  2befe98, health OK). Primer día de tráfico REAL de Elegance**: 75
  conversaciones nuevas, 194 turnos WhatsApp, 2,1M tokens de entrada, 2 órdenes
  reales, 0 errores en event_log.
  - **Fix del doble pitch en fotos**: `enviar_imagen_producto` perdió el
    parámetro `mensaje` — el modelo escribía el pitch completo como caption y
    lo repetía en el texto final (2 burbujas casi idénticas + salida doble).
    La foto sale SOLA; el texto del turno es el único pitch; `content` del
    mensaje = `[foto] título` (el caption-pitch tampoco contamina más el
    historial). Regla del prompt alineada.
  - **`MAX_HISTORY` 24→20, decidido con datos**: las 2 órdenes reales del día
    midieron 17 y 55 mensajes antes del cierre; la de 55 cerró bien porque el
    modelo SIEMPRE re-llama `buscar_productos` en el turno del `crear_orden`
    (el historial reconstruido entre turnos NO trae las rondas de tools
    previas) — el `producto_id` de los items nunca depende de la ventana.
    Distribución: p50=4 msgs, p90=19. 16 quedaba al borde del cierre real de
    17; se eligió 20.
  - **Hallazgos Fase 0 de la spec** (importante para futuras "optimizaciones"):
    el logging de usage (Fase 1) y `thinkingLevel low` (Fase 3, mínimo en 3.x)
    YA existían; reordenar el prompt para caché (Fase 2) NO aplica — el system
    prompt ya es 100% estático por tenant y `toolDeclarations` determinístico.
    El hit-rate bajo (~18%) es estructural: **el mínimo de caché implícito de
    `gemini-3.5-flash` es 4.096 tokens** y el prefijo estático mide ~3k (las
    rondas 1 de conversaciones cortas no cachean), + ventana deslizante +
    historial sin rondas de tools. Dentro del turno el caché sí pega (49%
    observado en turnos largos). `THINKING_LEVEL` ahora se exporta de
    `gemini.ts` (reminders lo reutiliza).
  - **Batería 5/5 contra Gemini real (testMode)**: saludo / búsqueda+foto sin
    duplicar / objeción de precio / cierre con 2 productos y datos en desorden
    (orden simulada $153.000: envío $18.000, Antioquia deducida de Medellín,
    teléfono del canal) / escalamiento.
  - **Hallazgo operativo pendiente**: 6 turnos del día (~3%) con respuesta
    VACÍA de Gemini (output 0) → bot mudo; uno dejó a un cliente sin responder.
    Solo se loguea con `console.error` en Vercel — NO llega a event_log ni a
    /admin/health.

- **Sesión 2026-07-12 — Audios del dashboard + buscador de clientes + Spec 11
  (DESPLEGADO en producción, merge efca5ed, health OK, smoke post-deploy verde)**:
  - **Fix audios en Conversaciones/Tickets (reporte del cliente)**, dos causas:
    (1) el worker inserta el mensaje de audio SIN `media_path` y lo completa con
    un UPDATE tras subirlo a Storage, pero las vistas solo escuchaban INSERT de
    Realtime → en vivo la nota de voz quedaba como texto `[nota de voz]` sin
    reproductor hasta recargar. Ambos clients escuchan ahora también UPDATE
    (merge por id; verificado que el evento llega a `authenticated` bajo RLS).
    (2) WhatsApp usa OGG/Opus, que Safari (Mac/iPhone) no reproduce: nuevo
    fallback `?format=wav` en `/dashboard/media/[id]` que transcodifica
    server-side (`lib/audio/ogg-to-wav.ts`, paquete `ogg-opus-decoder` WASM
    puro — requiere `serverExternalPackages` en next.config.ts porque el
    bundler no resuelve sus workers). `MessageBody` compartido
    (`app/dashboard/message-body.tsx`) detecta soporte con `canPlayType` y
    elige la URL. Sin flag, el redirect firmado queda intacto. Bonus:
    `extFor` recorta parámetros del mime (`audio/ogg; codecs=opus` → `.ogg`,
    antes `.bin`).
  - **Buscador de clientes en `/dashboard/conversations`** (pedido del
    cliente): server-side vía `searchParams.q` (patrón de /admin/requests),
    busca por teléfono parcial y por nombre en `customers`, y la lista/detalle
    muestran el **nombre del CRM** junto al teléfono. RLS intacto (cliente
    authenticated). Verificado e2e con usuario desechable (patrón del verify)
    contra dev y producción.
  - **Spec 11 — `thinkingBudget: 0` en reminders**: medido en producción
    (2026-07-12) cada reminder quemaba ~560 tokens de thinking (facturado como
    salida) para ~45 de salida real (11x); los 125 reminders del día generaron
    más thinking (70K) que las 471 llamadas de WhatsApp juntas (38K). La
    llamada de reminders es propia (fetch en `lib/ai/reminders.ts`, no comparte
    config con el asesor): cambio de 13 líneas. Verificado 3/3 contra Gemini
    real: `thoughts=0`, STOP, calidad/tono igual. Si la API rechazara el
    parámetro, el catch existente cae al texto fijo de fallback.

- **Sesión 2026-07-14 — Videos entrantes + hora en burbujas + fix pedidos
  dobles (rama `feature/video-hora-orden-dedup`, DESPLEGADO en producción)**:
  - **Videos entrantes (reporte del cliente: "formato equivocado" y el agente
    no sabía qué video era)**. Migración #19: `messages.msg_type` admite
    `'video'` — OJO: el CHECK de msg_type NO existía en la DB viva (0001 se
    editó después de aplicado); la migración usa `drop if exists` + `add` y lo
    normaliza. `shapeInbound` case `video` (content `[video] caption`), el
    video se descarga y persiste en `wa-media` (`extFor` + `video/mp4`/`3gpp`)
    y **JAMÁS va inline a Gemini** (~300 tokens/seg; filtro `video/*` en
    `collectTurnMedia`). El worker corta ANTES de llamar a Gemini si el turno
    pendiente trae un video: respuesta enlatada `VIDEO_RECEIVED_REPLY` +
    ticket `video_recibido` + `event_log` kind `video_received` — **cero
    tokens**. Helper nuevo `escalateWithCannedReply` (generaliza el escalado
    de fallo técnico; ambos lo usan). `MessageBody` reproduce el video
    (`<video controls>`; el route handler `/dashboard/media/[id]` sirvió sin
    cambios y el UPDATE de Realtime del 07-12 lo muestra en vivo).
  - **Hora en las burbujas** de Conversaciones y Tickets (pedido del cliente):
    `sender · HH:mm` (`toLocaleTimeString es-CO`; `created_at` ya venía en el
    select y en Realtime, solo faltaba renderizarlo).
  - **Fix pedidos dobles — CONFIRMADO en producción**: 3 conversaciones del
    12-13 jul con 2/2/4 órdenes (gaps 9s–2min). Causas reales (transcripción):
    (1) el cliente corrige datos POST-orden ("Ya es en Pereira", "solo el
    kit") y el modelo "corregía" creando OTRA orden — cero idempotencia en
    todo el flujo; (2) carrera del debounce: 2 mensajes a ~8,5s → 2 workers
    solapados → doble respuesta + doble orden. Fix en 4 capas:
    **(a)** guard 24h por conversación en `crearOrden` (`ORDEN_YA_EXISTE` con
    minutos y total → instruye escalar con motivo NUEVO `cambio_en_orden`);
    **(b)** guard de mismo turno `ctx.createdOrder` (functionCalls paralelos o
    rondas 2+ devuelven el mismo resultado; los reintentos por
    `FALTA_DEPARTAMENTO` siguen vivos porque solo se memoriza el ÉXITO);
    **(c)** regla de prompt "UNA sola orden por venta; correcciones →
    escalar"; **(d)** re-check "último gana" justo antes de ENVIAR la
    respuesta (si llegó un mensaje más nuevo se descarta, `event_log`
    `stale_reply_dropped`) — mata la doble respuesta de la carrera. SIN unique
    constraint en `orders(conversation_id)`: compras legítimas repetidas en el
    tiempo son válidas; el corte es la ventana de 24h. Los cambios a órdenes
    existentes SIEMPRE van a humano (el bot no tiene tool de editar/cancelar).
  - **Verificado**: migración aplicada; typecheck/build/`verify` 4/4; guard
    2/2 contra la DB (script desechable); y 2 pruebas contra **Gemini real**:
    turno de corrección → escala `cambio_en_orden` SIN llamar `crear_orden` ni
    crear orden; cierre normal (testMode) → sigue llamando `crear_orden` con
    total correcto ($117.900 con envío).

- **Sesión 2026-07-14 (bis) — Módulo «Plan» + alertas de créditos/facturación
  (rama `feature/billing-plan`)**:
  - **Migración #20** (`0020_billing.sql`): `tenants.billing_due_date` (fecha
    de corte), `billing_status` ('pagado'/'pendiente', default 'pagado' para
    no alarmar a clientes existentes) y `addon_price` (COP del paquete
    adicional). La mensualidad sigue siendo `monthly_fee` (migración #8) y el
    tamaño del plan es `message_limit`.
  - **`lib/billing.ts`**: constantes de la plataforma — datos de pago (Nequi/
    Llave `314 668 1896` y Davivienda ahorros `4884 4795 4865`, titular Juan
    Arango C.C. 1.088.018.943), `ADDON_MESSAGES = 2000`, `billingInfo()`
    (deriva pendiente/vencida comparando por día en America/Bogota),
    `formatCop`/`formatDueDate`.
  - **Dashboard del cliente**: banner global `BillingAlert` en el layout
    (prioridad: créditos agotados 🚫 > factura vencida 🚫 > ≥80% ⚠️
    "recuerda recargar para no quedarte sin el servicio") con botón «Ver plan
    y pagos» SOLO para rol admin (a los agentes les dice que hablen con su
    administrador). **Módulo nuevo `/dashboard/plan`** (nav «Plan», gate
    `role === "admin"` — `app_users.role` YA existía desde 0001 y los
    usuarios creados desde /admin son admin por defecto — + opt-out
    `modules.plan`): plan contratado, mensualidad, consumo con barra, paquete
    adicional (si `addon_price`), estado del pago (al día / factura pendiente
    con monto y corte / vencida), datos de pago y la narrativa "el pago se
    realiza en la fecha de corte o al agotar los créditos, lo que ocurra
    primero".
  - **/admin**: card «Plan y facturación» en el detalle del cliente (fecha de
    corte, estado pagado/pendiente, precio del adicional; action
    `updateTenantBilling` auditada `update_billing`); la lista de clientes
    marca consumo "por agotarse ⚠️"/"sin créditos 🚫" (barra ámbar/roja) y
    badge "Pago pendiente/VENCIDO · $fee" junto al plan.
  - **Verificado**: typecheck/build/`verify` 4/4 + prueba desechable (tenant +
    usuario admin vía RLS): los campos de facturación llegan al cliente
    authenticated, `role` legible, `billingInfo` detecta pendiente+vencida y
    consumo 85%. OJO: el gate del módulo es de UI/server (redirect); un
    'agent' curioso podría leer los campos de facturación por PostgREST — no
    son secretos del tenant, se aceptó.

- **Sesión 2026-07-14 (ter) — Fix respuesta corrupta (caso Patricio) + correos
  solo por tickets (rama `fix/history-model-turn-emails`)**:
  - **Bug real en producción (conv `acc0f1e7…`)**: 2 mensajes
    del cliente separados por 9,2s (justo sobre el debounce de 8s) → 2 workers
    paralelos; el worker A envió la FOTO (la tool `enviar_imagen_producto`
    inserta un mensaje del bot al historial DURANTE el turno) y su texto fue
    descartado por el "último gana" nuevo; el worker B leyó el historial
    DESPUÉS de la foto → su `contents` terminó en TURNO DEL MODELO y Gemini
    "continuó" ese turno: completó la ficha a mitad de frase con **precio
    inventado ($155.000; el real es $180.000)** e inventó el siguiente mensaje
    del cliente ("--- Hola, buenas…"). Es OTRA cara de la regla "el contents
    debe terminar en turno del cliente" (además del texto vacío ya conocido).
  - **Fix**: en el worker, tras armar `history`, se recorta del final toda
    fila `sender !== 'customer'` (y guard de historial vacío). **Reproducido y
    verificado contra Gemini real**: sin recorte → continuación basura sin
    tools; con recorte → `buscar_productos` + foto + precio real $180.000.
  - **Correos solo accionables**: se eliminó `notifyNewConversation` (worker y
    email.ts) — con 75-100 conversaciones nuevas/día agotaba la cuota diaria
    de Resend gratis (100/día; 36 `notify_failure` el 2026-07-13) y tumbaba
    los correos que SÍ importan. Quedan: tickets escalados y Solicitudes.
  - **Chequeo de salud del día**: 0 pedidos dobles post-deploy;
    `stale_reply_dropped` ya evitó 2 dobles respuestas; 1 solo error 24h
    (Gemini "service unavailable" → escaló bien); 398 reminders/24h.

- **Sesión 2026-07-14 (quater) — Feature C spec 07: alertas Telegram al DUEÑO
  (rama `feature/telegram-alerts`; falta solo el token del bot para probar)**:
  - **`lib/notify/telegram.ts`**: `sendTelegramAlert` best-effort (patrón
    email/tts: JAMÁS lanza, timeout 10s, no-op sin `TELEGRAM_BOT_TOKEN`/
    `TELEGRAM_CHAT_ID` → desplegable sin configurar, rollback = borrar las
    vars). Fallos SOLO a console (nunca logEvent: evita recursión). Bot API
    pura con fetch, parse_mode HTML. Costo $0, sin cuotas (vs Resend).
  - **3 hooks**: (a) `logEvent` con `severity=error` → 🔴 (punto único: cubre
    assistant_error/escalation_auto/queue_failure/oauth_failure y futuros);
    (b) worker paso 5 → cruce EXACTO de créditos: 🟠 al 80%
    (`current_count === Math.round(limit*0.8)`, fórmula verificada idéntica
    al `(v*0.8)::int` de SQL en 7 límites) y 🔴 al llegar al límite
    (`current_count === limit+1`) — una vez por periodo sin dedup extra
    porque el contador pasa por cada valor una sola vez (OJO:
    `at_80_percent` del RPC es true en CADA mensaje desde el 80%, por eso NO
    se usa para alertar); (c) creación de Solicitud → 📩 con tenant +
    categoría + asunto. Decisión de Juan: SIN aviso por cada venta.
  - **Setup**: `npm run telegram:test` — sin CHAT_ID lista los chat_id que le
    escribieron al bot (getUpdates); con todo, manda el mensaje de conexión.
    Verificado: typecheck/build/verify 4/4 y no-op limpio sin envs.

- **Sesión 2026-07-15 — Fotos sin repetir + roles por etiquetas en tickets
  (DESPLEGADO en producción: merge `4ab4498`, migración #21 aplicada, health
  OK `db:up`, smoke de rutas verde; typecheck/build/verify 4/4 + 32 checks
  DB + 5/5 Gemini real)**:
  - **Guard de fotos (global, sin migración)**: el bot mandaba foto en cada
    mensaje. `enviar_imagen_producto` ahora deduplica server-side contra
    `messages` (`sender='bot'`, `msg_type='image'`, `media_url`, episodio
    desde `closed_at`): con `cantidad=1` y el producto ya fotografiado
    devuelve `foto_ya_enviada` (no envía); `cantidad>1` (cliente pidió
    ángulos) envía SOLO las fotos que faltan de la galería; galería agotada →
    `fotos_ya_enviadas`; parámetro nuevo `reenviar=true` para reenvío
    explícito ("se me borró el chat") — nunca repite dentro del mismo turno
    (`ctx.sentImageUrls`, patrón calledTools). En sandbox del tester (con
    conversationId, sin wa) ahora PERSISTE el marcador `[foto]` → el guard
    funciona entre turnos del probador. Regla del prompt alineada
    (`lib/ai/prompt.ts`). La frecuencia/estilo por tenant sigue siendo del
    `system_prompt`.
  - **Etiquetas de tickets (migración #21)**: `ticket_labels` por tenant
    (seed: Servicio al cliente, Ventas, Garantías, Reclamos, Logística/Guías;
    también en `upsertTenant` para altas nuevas), `app_user_labels`
    (asignación usuario×etiqueta, FKs compuestas anti cross-tenant),
    `tickets.label_id` (`on delete set null`). Helper SQL
    `current_user_role()` (SECURITY DEFINER) + policy nueva
    `app_users_admin_select` (el admin del tenant lista su equipo). RLS:
    escritura solo admin del tenant (REVOKE + grants por columna, patrón
    0018). **La IA elige la etiqueta**: `buildToolDeclarations(labels)`
    agrega a `escalar_a_humano` el param `etiqueta` con enum DINÁMICO por
    tenant (orden estable → caché implícita intacta; sin etiquetas =
    declaraciones idénticas a hoy); fallback determinista motivo→etiqueta
    (`lib/tickets/labels.ts`, `REASON_TO_LABEL`) en `resolveLabelId`;
    escalados automáticos (fallo_tecnico/video_recibido) resuelven dentro de
    `escalateToHuman` (worker sin cambios). `generate()` de gemini.ts ahora
    recibe las declarations por parámetro.
  - **Dashboard**: `/dashboard/tickets` filtra por rol — agente ve tickets de
    sus etiquetas + los SIN etiqueta; agente sin etiquetas asignadas ve todo;
    admin ve todo (query `.or(label_id.is.null,label_id.in.(...))`, el
    Realtime ya filtraba solo vía router.refresh). Badge de etiqueta en lista
    y detalle. **Módulo nuevo `/dashboard/labels`** («Etiquetas», solo rol
    admin + opt-out `modules.labels`): CRUD de etiquetas (renombrar/activar/
    desactivar/eliminar con confirmación y conteo de tickets abiertos) +
    matriz de asignación por agente.
  - **«Pasar a Tickets» desde Conversaciones**: botón en el detalle (visible
    en `bot_active`/`closed`) para cuando el equipo detecta que puede
    responder mejor que el bot — `sendToTickets` (RLS, cualquier usuario del
    tenant) pone `requires_human` + ticket `reason: intervencion_manual` SIN
    etiqueta (lo ve todo el equipo) y SIN correo (lo escaló el propio
    equipo); ya escalada = no-op. Mismo ciclo de vida: responder/resolver en
    Tickets devuelve al bot. Verificado con 4 checks RLS (agente escala la
    suya, cross-tenant bloqueado 42501/0 filas).
  - **Verificado**: prueba Gemini real 5/5 (foto 1 vez → turno siguiente sin
    repetir → "más fotos" manda 3 nuevas con `cantidad=3` → "reenvíame la
    foto" usa `reenviar=true` → escalada por garantía eligió
    `etiqueta: "Garantías"` del enum). 28 checks DB (guard fotos con
    closed_at, mapeo 7 reasons, RLS agente/admin, FK cross-tenant 23503,
    filtro .or). OJO: el UPDATE de un agente sobre ticket_labels no da error
    (grant de columna lo permite) pero la policy deja 0 filas — seguro.

- **Sesión 2026-07-15 (bis) — Números de prueba por tenant (DESPLEGADO:
  merge `4c48ebe`, migración #22 aplicada, health OK; typecheck/build verdes,
  4 checks DB)**: Juan puede probar desde su número real (+573146681896, ya
  configurado para Elegance dev) sin gastar el plan del cliente.
  - **`tenants.test_phones` (jsonb)**: lista E.164 editable en /admin («Datos
    del cliente», coma-separada, se normaliza a +57). El worker marca la
    conversación `is_test` al entrar el número (y lo REVIERTE si el número
    sale de la lista) y con `is_test` SALTA `increment_message_counter`
    completo: no descuenta, no alerta créditos por Telegram y el bot responde
    aunque el tenant esté al límite. CRM: el contacto de prueba no se upserta.
  - **Dashboard**: Conversaciones ya NO oculta `is_test` — badge ámbar
    «Prueba» en lista y detalle + nota "sus mensajes no descuentan de tu
    plan". La única oculta sigue siendo la sintética del probador
    (`+570000000000`). Métricas: además de conversaciones, ahora también
    excluye las ÓRDENES de conversaciones de prueba (filtro
    `.or(conversation_id.is.null,conversation_id.not.in.(...))` — las órdenes
    con conversación borrada siguen contando) y el top de productos filtra
    por esas mismas órdenes (`order_items.order_id`).
  - **Bonus**: `gemini_usage` del worker marca `source: "whatsapp_test"` para
    separar el gasto de pruebas en /admin/health.
  - OJO: una venta cerrada desde el número de prueba SÍ crea la orden real en
    Shopify (a propósito: prueba e2e) — cancelarla allá; en métricas no cuenta.

- **Sesión 2026-07-16/17 — 4 specs de optimización del dashboard (MERGEADAS a
  main, migraciones #23-#25 aplicadas, typecheck/build/verify verdes, deploy
  en curso al escribir esto)**:
  - **Spec A — Identidad + «Respondida por» (migración #23)**: `app_users.name`
    (se gestiona SOLO desde /admin: input en el alta + action `updateUserName`
    auditada), `messages.sent_by` (las actions de tickets lo escriben
    server-side desde el contexto auth; los 218 mensajes históricos quedan
    NULL → "agent"), `tickets.resolved_by`, y policy `app_users_team_select`
    (todo el equipo resuelve id→nombre/email; sin write para authenticated).
    Tickets y Conversaciones muestran `{nombre} · HH:mm` en burbujas de
    agente; la matriz de /dashboard/labels muestra nombre + correo. Bonus:
    RLS habilitado en `_migrations` (advisor de Supabase; el runner conecta
    como postgres/owner → no le aplica). Verificado 6/6 checks RLS.
  - **Spec B — Visibilidad ESTRICTA de tickets (migración #24)**: la policy
    `tenant_isolation` de tickets se separó por verbo; el SELECT impone la
    regla en la DB: admin ve todo; agente ve sus etiquetas + los sin
    etiqueta; agente SIN etiquetas ve SOLO los sin etiqueta (se INVIRTIÓ el
    opt-in de 0021 "sin etiquetas ve todo" — decisión de Juan 2026-07-16).
    El filtro de query en /dashboard/tickets aplica siempre (defensa en
    profundidad); badge «Sin etiqueta» en lista y detalle. Realtime respeta
    el SELECT. Verificado 5/5 (admin 3 / agente-X 2 / agente-sin 1 /
    cross-tenant 0 / insert manual OK).
  - **Spec C — Ventas por fecha + política de datos**: `lib/dates.ts`
    (`bogotaDayStart/End`, offset fijo -05:00, verificado que las 23:30 COT
    caen en su día). Métricas acepta `?from/?to` (días Bogotá) que prevalece
    sobre Semana/Mes y aplica a órdenes, ventas y top de productos.
    `/dashboard/legal`: Política de Tratamiento de Datos (Ley 1581/2012,
    texto estándar adaptado a Nitro Ecom, versionada en el repo v1.0) +
    link en el bloque inferior del sidebar. OJO: pendiente revisión legal
    del texto (doc 06 de Drive sigue en borrador).
  - **Spec D — Módulo «Búsquedas» (migración #25)**: tabla `search_log`
    (lectura RLS por tenant; escritura SOLO service_role con revoke
    explícito — patrón 0018). `buscar_productos`/`ver_detalle_producto`
    registran best-effort (`lib/ai/search-log.ts`, jamás lanza) la consulta,
    `result_count` y `top_similarity`; el probador (testMode) NO escribe.
    `/dashboard/searches` (nav opt-out `modules.searches`): palabras más
    buscadas, productos más consultados (join a products con foto) y
    «búsquedas que tu catálogo no cubre» (sin resultados o similarity <0.45
    — umbral inicial a calibrar; la tabla muestra el %). Filtro de fechas
    Bogotá. Sin histórico: tool_trace no guarda conteos (v1 acumula desde el
    deploy). Verificado 7/7 contra RAG real (similarity 0.76 en búsqueda
    real de Elegance).

- **Sesión 2026-07-17 — Ciclo de facturación por PAGO (migración #26,
  MERGEADO y desplegado; verificado 13/13 contra la DB real)**: el ciclo NO lo
  manda el calendario sino el pago (decisión de Juan). Detalle:
  - **Tabla `invoices`** (una `renovacion` y un `adicional` por ciclo — unique
    index `(tenant_id, concept, cycle_start)` con `cycle_start =
    counter_period_start`): el cliente LEE las suyas por RLS
    (/dashboard/plan); escribe solo service_role (revoke patrón 0018).
  - **`lib/billing-cycle.ts`** (el worker lo llama tras el RPC del contador):
    (a) plan agotado + `tenants.addon_enabled` → factura del adicional
    (ADDON_MESSAGES=2000, precio `addon_price`) y el bot SIGUE respondiendo;
    (b) renovación al 80% del total del ciclo (plan, o plan+2000 si entró el
    adicional) o a ≤10 días del corte (cron diario nuevo `/api/cron/billing`,
    11:00 UTC, misma idempotencia); (c) agotado el TOTAL sin pago → el bot se
    PAUSA (palanca de cobro). Alertas Telegram en cada cruce (no-op sin
    envs). Best-effort: fallo al facturar jamás tumba la respuesta.
  - **«Marcar pagada»** (botón por factura en /admin, card Plan y
    facturación, auditado `invoice_paid`): renovación → contador a 0, corte =
    hoy(Bogotá)+1 mes, aplica `pending_plan` si existe, `billing_status`
    recalculado (pagado solo sin pendientes); adicional → solo limpia deuda.
  - **Cambio de plan** en «Datos del cliente» con radio: «ahora» (pisa el
    ciclo) o «al próximo ciclo» (queda en `tenants.pending_plan` y lo aplica
    el pago de la renovación; badge ámbar con lo programado).
  - **Funciones SQL** (`increment_message_counter`,
    `reset_stale_message_counters`) ya NO resetean por calendario a los
    tenants con `billing_due_date`; sin corte configurado el comportamiento
    mensual sigue idéntico (Elegance sigue mensual hasta que Juan configure
    su corte en /admin).
  - Dashboard cliente: banner y /dashboard/plan entienden el adicional (barra
    contra el total del ciclo, «estás usando el paquete adicional», lista de
    facturas con estado).

- **Sesión 2026-07-17 (bis) — vencimiento del adicional + rescate de Elegance
  (merge 189af77)**: el adicional con factura PENDIENTE vence a los 15 días
  (`ADDON_PENDING_DAYS` en lib/billing.ts) y el bot se pausa aunque queden
  mensajes; PAGADA no vence (manda solo el tope de 2.000). Caso real: Elegance
  agotó sus 5.000 pagados con `addon_enabled` APAGADO → bot pausado → Juan usó
  «Marcar pagada» en la renovación de $480k para despausar → el sistema
  (correctamente) regaló ciclo nuevo. Restaurado a mano (script + audit_log):
  ciclo del 12-jul, contador 5003, renovación $480k PENDIENTE, adicional
  $120k PENDIENTE (generado por el flujo real), addon ON, bot respondiendo.
  **REGLA para Juan: «Marcar pagada» en una renovación SOLO cuando el cliente
  pagó de verdad — resetea el ciclo.** Verificado 5/5 vencimiento + 13/13
  regresión.
  - **(quinquies) Pago anticipado programado (merge 394cd2d)**: «Marcar
    pagada» una renovación con créditos vivos ya NO resetea al instante — el
    pago queda PROGRAMADO (detección: invoice renovacion pagada con
    cycle_start del ciclo vigente) y el ciclo nuevo arranca solo al agotar
    los créditos (worker; el mensaje que cruza cuenta en el ciclo nuevo) o al
    llegar el corte (`activateDueRenewals` en el cron diario), lo primero;
    corte = arranque + 1 mes, aplica pending_plan. Bot ya pausado/corte
    vencido → reset inmediato. Así el cliente no pierde mensajes pagados del
    adicional. Verificado 6/6 + 14/14 regresión.
  - **(quater) Vencimiento por factura (migración #27, merge 24c7a9a)**:
    `invoices.due_date` — renovación nace con el corte del tenant (etiqueta
    «próximo ciclo» mientras esté pendiente), adicional con emisión+15 días;
    visible en /admin y en el Plan del cliente («paga antes del …»). Se
    ELIMINÓ el selector manual «Estado del pago» (lo derivan las facturas).
    Backfill Elegance: factura histórica PAGADA del plan del 12-jul
    (cycle_start anclado al 12-jun para el unique index) + vencimientos
    (adicional 01-ago, renovación 12-ago). NO existe creación manual de
    facturas: todo es automático.
  - **(ter) Contador consciente del adicional (merge 3700558)**: Juan repitió
    el «Marcar pagada» porque el contador mostraba «5.004/5.000 sin créditos
    🚫» estando en la fase VÁLIDA del adicional. Fix: lista de /admin, detalle
    del cliente, /admin/summary, Inicio del dashboard y pie de Métricas
    muestran el consumo contra el total del ciclo (plan+2.000 si el adicional
    está ON) con «adicional en uso 🟠»; «sin créditos 🚫» solo al agotar el
    total. «Marcar pagada» pide confirmación (client component
    `mark-paid-button.tsx`) explicando el reset. Elegance restaurado por 2ª
    vez (contador 5.004, ciclo 12-jul, corte 12-ago, renovación $480k
    PENDIENTE).

- **Sesión 2026-07-18 — Spec 13: Carritos abandonados (rama
  `feature/abandoned-carts`, migración #28 aplicada; typecheck/build/verify
  4/4 + 14/14 checks DB + envío REAL de plantilla verificado)**: recuperación
  por WhatsApp con plantillas de marketing de Meta. Facturable (Fase 4),
  acordado con Elegance. Verificado por API: plantillas
  `carrito_recordatorio_1/2` AMBAS aprobadas en la WABA, idioma **`es_CO`**,
  botón URL base `https://elegancecolombia.com/checkouts/cn/` + sufijo.
  - **Migración #28**: `abandoned_checkouts` (unique `(tenant_id,
    checkout_token)`, estados SOLO adelante pending→reminded_1→reminded_2→
    recovered/cancelled/opted_out/expired, `last_activity_at` como reloj,
    `recovered_shopify_order_id` TEXT — NO FK a orders: las compras web no
    existen localmente; RLS lectura tenant, escritura service_role patrón
    0018/0025), `customers.marketing_opt_out`,
    `tenants.abandoned_carts_enabled` (default OFF) + `cart_settings` jsonb
    (defaults en `lib/carts/settings.ts`: delays [60,1440] min, nombres de
    plantilla, idioma es_CO, `checkout_url_base` — VACÍA = cron no envía).
  - **Ingesta** (`lib/carts/checkouts.ts`): topics nuevos `CHECKOUTS_CREATE/
    UPDATE` + `ORDERS_CREATE` en el MISMO route/HMAC (switch por topic;
    registro por-topic con "failed" sin tumbar los demás — YA registrados en
    Shopify dev). Sin teléfono se ignora; cada update reprograma el reloj;
    `completed_at` u orders/create cierran (recovered si hubo recordatorio,
    cancelled si no; match por checkout_token y fallback teléfono 7d).
    orders/create también captura ventas cerradas por el BOT.
  - **Envío** (`lib/carts/reminders.ts` + cron `/api/cron/cart-reminders`
    cada 15 min — plan Pro confirmado): ventana 8:00-20:00 Bogotá en código,
    máx 2/checkout, 1/comprador/día (varios vencidos del mismo teléfono: gana
    el más reciente, resto expired), opt-out, "no molestar" si conversación
    escalada o sesión <24h (posterga), doble check de orden local, URL debe
    empezar EXACTO por la base (mismatch → expired + event_log), fallo de
    Meta → 1 reintento → expired. Variables server-side (nombre "de nuevo"
    como fallback, producto + "y N más", total formatCop). `sendTemplate`
    nuevo en `lib/whatsapp/meta.ts`. Cada envío inserta el mensaje en la
    conversación (get-or-create sin pisar estado) y telemetría `event_log`
    kind **`wa_template_usage`** (unit_cost_usd 0.0144 — fuente de verdad de
    facturación del módulo).
  - **Worker**: opt-out «BAJA» server-side ANTES de la IA (palabra exacta o
    frase en ≤12 palabras, `lib/carts/optout.ts`; respuesta fija, cero
    tokens/contador, kind `cart_optout`; solo tenants con módulo ON) +
    contexto de carrito vía `extraSystem` cuando el comprador con recordatorio
    (7d) escribe. `normalizeCoPhone` exportado de orders.ts (mismo E.164).
  - **UI**: `/dashboard/carts` (nav «Carritos» solo con
    `abandoned_carts_enabled` + `modules.carts !== false`; 3 contadores +
    tabla, filtro fechas Bogotá, solo lectura) y card «Carritos abandonados»
    en /admin (toggle + url base + delays + plantillas + idioma, action
    `updateCartSettings` auditada). OAuth: scope `read_checkouts` agregado.
  - **Verificado**: 14/14 (ingesta E.164/reloj/terminales, cierre por token y
    teléfono, optout 10 casos, RLS 3 checks 42501, settings merge) + plantilla
    REAL entregada al número de prueba (wamid OK, es_CO, botón con sufijo).
  - **OJO**: los webhooks de checkout ya apuntan a producción; hasta el deploy
    el código viejo los procesa como producto inexistente (delete no-op
    inofensivo). El módulo queda OFF por defecto para todos.

- **Sesión 2026-07-18 (bis) — revisión del commit manual de tickets + fix
  carritos `url_mismatch`**:
  - **Commit b1a5bc0 (Juan lo hizo a mano) VERIFICADO completo**: facturas
    manuales (migración #29: concept `manual`, `cycle_start` opcional,
    `description`; crear/eliminar desde /admin, el cliente las ve en Plan,
    `refreshBillingStatus` las excluye) + tickets asignados (migración #30:
    FK compuesta `(assigned_to, tenant_id)` con `set null (assigned_to)`,
    policy `tickets_select` reemplaza la de 0024: asignado lo ve SOLO ese
    usuario + admin; selector de destinatario en «Pasar a Tickets»). Ambas
    migraciones aplicadas; typecheck/build verdes; 12/12 checks RLS/FK con
    tenants desechables. El script desechable `_tmp-check-0029-0030.ts` que
    quedó committeado se retiró del repo.
  - **Fix carritos — por qué no se enviaban**: el módulo SÍ ingería checkouts
    reales (4 el 2026-07-18), pero la `abandoned_checkout_url` real de
    Shopify es `/{store_id}/checkouts/ac/{token}/recover?key=…` — jamás
    empieza por la base de la plantilla (`…/checkouts/cn/`) → regla 7
    (`url_mismatch`) expiraba TODOS los envíos. Verificado contra la tienda
    real: `…/checkouts/cn/{token}` (mismo token del formato ac) redirige a
    una sesión nueva CON el carrito intacto. `buttonSuffix()` en
    `lib/carts/reminders.ts`: sufijo directo si la URL empieza por la base;
    si no, extrae el token de `/checkouts/ac|cn/{token}` SOLO si el host
    calza con la base (tienda dev → null → expired, igual que antes). 9/9
    casos verificados con las URLs reales.
  - **Desplegado y VERIFICADO en producción**: merge `ffd03f9`, health OK.
    Los 3 checkouts expirados por el bug se revivieron a mano (script
    desechable) y el cron de las 14:15 UTC les envió `carrito_recordatorio_1`
    (3 `wa_template_usage` con wamid).
  - **Fallos de entrega de WhatsApp ahora visibles (commit `fa9a803`)**: la
    Cloud API acepta el envío (devuelve wamid) aunque no pueda entregar; el
    fallo llega después como status `failed` que el webhook ignoraba. Ahora
    `extractFailedStatuses` + `event_log` kind **`wa_delivery_failure`**
    (warning, con recipient y errores de Meta) — visible en /admin/health.
    Caso real que lo motivó: recordatorio de carrito al número de prueba
    3150259785 "salió" pero no llegó → reenvío diagnóstico capturó **error
    131049** ("not delivered to maintain healthy ecosystem engagement") =
    límite de frecuencia de PLANTILLAS DE MARKETING por usuario de Meta, no
    un bug. Afecta a números SIN engagement previo con el negocio (el número
    de prueba de Juan +573146681896 sí recibe: ya chatea con el bot). Es
    política de Meta: compradores reales que ya escriben por WhatsApp tienen
    mejor entregabilidad; vigilar `wa_delivery_failure` los primeros días.

- **Sesión 2026-07-19 — Modo gracia + suspensión manual por pago (migración
  #31 aplicada; build/verify verdes + 11/11 checks DB con tenant desechable;
  DESPLEGADO en producción junto con el excedente de gracia — sesión bis)**:
  decisión de Juan — la pausa por falta de pago deja de ser automática; el
  corte es una palanca manual.
  - **Migración #31**: `tenants.service_paused` (default false). Independiente
    de `is_active` («Pausar cliente» apaga todo): suspendido, el bot calla en
    SILENCIO TOTAL sin consumir mensajes (gate 4b del worker, antes del
    contador); números de prueba siguen funcionando; webhooks/dashboard vivos.
  - **Modo gracia** (`lib/billing-cycle.ts`): agotar el total del ciclo sin
    pago ya NO devuelve `allowed: false` — el bot sigue respondiendo; alerta
    🔴 a Juan en el cruce exacto. El vencimiento del adicional a 15 días
    tampoco pausa. (Los mensajes de gracia se DESCUENTAN del ciclo nuevo
    desde la sesión bis del mismo día — ver abajo; la "cortesía asumida"
    original duró horas.)
  - **Urgencia sostenida**: banner del cliente reescrito (suspendido >
    gracia > vencida > 80%): en gracia es rojo amable con el MONTO de la
    renovación («sigue atendiendo por cortesía… realiza hoy el pago»); y
    recordatorio DIARIO a Juan por Telegram (`sendOverduePaymentAlerts` en el
    cron `/api/cron/billing`): tenants en gracia con renovación pendiente +
    adicionales vencidos; omite los ya suspendidos. Sin correos (decisión).
  - **Botón «Suspender bot por pago» / «Reactivar bot»** en el detalle de
    /admin (`service-paused-button.tsx`, confirmación explícita; action
    `setServicePaused` auditada `service_suspend`/`service_resume`); badge
    rojo en el header del detalle y en la lista de clientes. «Marcar pagada»
    la renovación REACTIVA automáticamente (`markInvoicePaid` limpia
    `service_paused`).
  - Suspendido: excluido de recordatorios de silencio (`lib/ai/reminders.ts`)
    y de plantillas de carritos (`lib/carts/reminders.ts`).
  - **Confirmado en esta sesión contra la DB real**: las facturas SÍ se
    generan solas (renovación al 80% o ≤10 días del corte; adicional al
    agotar el plan), los vencimientos están bien (renovación = corte;
    adicional = emisión+15d) y el reset por pago mueve el corte a
    día-del-arranque + 1 mes.

- **Sesión 2026-07-19 (bis) — Excedente de gracia descontado del ciclo nuevo
  (sin migración; typecheck/verify verdes + 7/7 checks DB con tenants
  desechables; DESPLEGADO en producción — push c9d1436, health OK
  `db:up`)**: decisión de Juan
  — los mensajes de gracia ya NO se regalan (reemplaza la "cortesía asumida"
  de la sesión anterior del mismo día).
  - **Regla**: al arrancar un ciclo nuevo, el contador arranca en
    `max(0, consumido − total facturado)` con total = plan + 2.000 si el
    adicional estaba activado (los 2.000 NO son excedente: su factura queda
    como deuda aparte, no se cobran doble). Ej.: Elegance consume 7.350 de
    7.000 → paga la renovación → ciclo nuevo arranca en 350 (le quedan 4.650
    de sus 5.000). El excedente se mide contra el plan VIEJO, antes de
    aplicar `pending_plan`.
  - **Implementación** (`activateNextCycle` en `lib/billing-cycle.ts`): perdió
    el param `countStart` — ahora lee consumo/límite/addon del tenant y
    calcula el carry él mismo. Cubre los 3 arranques: «Marcar pagada»
    (excedente grande típico), activación del pago programado al agotar
    (worker — el mensaje que cruza ES el excedente de 1, igual que el
    `countStart: 1` de antes) y cron del corte (sin excedente → 0, idéntico a
    hoy). Devuelve el carry para la alerta.
  - **Textos alineados**: alerta 🔴 de cruce a gracia y banner rojo del
    cliente avisan que el excedente se descontará; alerta 🟢 nueva al pagar
    con excedente dice cuántos se descontaron; confirm del botón «Marcar
    pagada» ya no promete "contador a 0".
  - **Verificado 7/7** (script desechable, tenants PRUEBA-BORRAR ya
    borrados): gracia con adicional 2450/2100→350, sin adicional 130/100→30,
    corte sin excedente→0, créditos vivos→programado intacto, cruce con pago
    programado 101/100→1, pending_plan + carry 160/100→60 con límite nuevo.

- **Sesión 2026-07-21 — Videos: visibilidad, envío del agente y videos de
  producto (3 deploys a producción: 40adaa3, 84de651, badccad; migración #32
  aplicada; health OK)**:
  - **Investigación "Elegance no ve los videos"**: la cadena técnica estaba
    100% sana (4 videos entrantes H.264/AAC en Storage; e2e real con usuario
    desechable contra producción: `/dashboard/media/[id]` → 307 → 206 con
    Range). La causa era la **visibilidad estricta de tickets (0024)**: los
    tickets `video_recibido` salían con etiqueta "Servicio al cliente" y los
    agentes de otras etiquetas NO los veían. Fix: `video_recibido` se quitó
    de `REASON_TO_LABEL` (ticket sin etiqueta = visible para todo el equipo);
    los 2 tickets de video abiertos se destiquetaron a mano en la DB.
  - **Envío de media del agente reescrito (fix de fondo)**: `sendVideo` nuevo
    en meta.ts y Tickets acepta video MP4/3GP ≤16 MB… pero la prueba real de
    Juan reveló que **Vercel corta el body de una función en 4,5 MB (límite
    de PLATAFORMA, inconfigurable)** — el primer intento con
    `bodySizeLimit: 17mb` (ab55f14) no bastó y se revirtió. Arquitectura
    final (84de651): `prepareAgentMediaUpload` (valida sesión/conv/mime/
    tamaño y firma URL con `createWaMediaUploadUrl` en storage.ts) → el
    navegador sube DIRECTO a Supabase Storage (`uploadToSignedUrl`) →
    `sendUploadedMediaFromAgent` (verifica prefijo del path anti
    cross-tenant, baja de Storage, sube a Meta, envía, persiste). Verificado
    con el video real de 13 MB + RLS bloquea escritura sin token. De paso
    quedaron arreglados fotos/audios >1 MB del agente (rotos en silencio
    desde siempre). Falta re-prueba de Juan post-deploy.
  - **Videos de producto — el bot los envía (migración #32,
    `products.video_urls`)**: la tienda sube el video a la GALERÍA del
    producto en Shopify (media nativa; se descartaron metafields por
    fricción). El sync pide `... on Video { sources }` y guarda la rendition
    MP4 de mayor resolución que quepa en 16 MB (Shopify transcodifica a
    H.264/AAC, lo que exige WhatsApp; `fileSize` viene en la API). Tool nueva
    `enviar_video_producto`: solo cuando el cliente PIDE video/demostración,
    envía por `link:` del CDN de Shopify (cero storage, cero tokens), guard
    anti-repetición por episodio (patrón fotos, `msg_type='video'` +
    `sentVideoUrls`), `reenviar=true` como excepción; sin video →
    `sin_video` y la IA ofrece fotos SIN escalar (regla de prompt nueva).
    Videos EXTERNOS (YouTube) no se pueden enviar como video de WhatsApp.
    **Verificado 7/7**: sync real contra Shopify dev, guard 4 casos (conv
    desechable), y Gemini real 2/2 (pide video → tool + pitch; sin video →
    foto sin escalar). El panel ya reproduce estos videos sin cambios
    (media_url externa → redirect).
  - **Storage medido**: 80 MB totales tras ~3 semanas de Elegance (~100
    MB/mes por tenant activo; videos entrantes = la mitad con 5 archivos).
    Sin riesgo de cuota; retención de media = opción futura en el cron.

- **Sesión 2026-07-22 — Tickets (avisos + reasignar), Blocklist y
  entregabilidad de carritos (rama `feature/tickets-blocklist-carts`,
  migraciones #34-#36 APLICADAS; typecheck/build/verify 4/4 + 56 checks
  desechables; NO desplegado al escribir esto)**:
  - **Carritos — 6 bugs de entregabilidad (migración #34)**: (1)
    `describeItems` usaba `??` y el `title: ""` que manda Shopify en ítems
    custom pasaba sin fallback → **parámetro VACÍO a Meta** (rechazo o
    plantilla con hueco); ahora `||` + `cleanParam` sanea todos los
    bodyParams. (2) La regla «1 recordatorio por comprador/día» calculaba el
    día con `getUTC*`: **entre 19:00 y 20:00 Bogotá se apagaba** (el día UTC
    ya era el siguiente y el filtro miraba al futuro) → `bogotaDayIso` en
    lib/dates.ts. (3) El dedup por teléfono expiraba a los checkouts
    "perdedores" ANTES de saber si el ganador salía; ahora solo tras `"sent"`.
    (4) El reloj del recordatorio 2 corría desde `last_activity_at`, que
    **cada `checkouts/update` de Shopify reprograma** → lo posponía
    indefinidamente; ahora cuenta desde `reminder_1_sent_at` (índice parcial
    nuevo). (5) No-molestar por sesión abierta 24h → 4h (el skip por
    `requires_human/human_active` queda igual). (6) Checkouts sin teléfono
    dejan traza (`cart_reminder`/`no_phone`, solo en la creación).
    Migración #34: `reminder_N_wamid`, `reminder_N_delivery`
    (none/accepted/delivered/failed), `reminder_N_delivered_at`,
    `next_retry_at`, `delivery_retries`, `clicked_at`/`click_count` y
    `customers.wa_undeliverable_at`. `wa_template_usage` incluye el
    `wa_message_id` → la facturación por fin cruza con los fallos.
  - **Carritos — checkout PRELLENADO (`link_mode`)**: el botón usaba
    `cn/{token}` = sesión nueva **con productos pero SIN los datos del
    cliente**. La URL que sí prellena (`ac/{token}/recover?key=…`) ya se
    guardaba en `abandoned_checkouts.abandoned_checkout_url`. Ruta pública
    nueva **`app/r/c/[id]`** (302 a esa URL, fallback `base+token`, uuid no
    adivinable, jamás 500, `/r/*` fuera del proxy) que además **mide CLICKS**
    (primer dato de conversión del módulo). `cart_settings.link_mode`
    (`"token"` default = deploy inerte | `"redirect"`) con selector en
    /admin. **Requiere plantillas v2 aprobadas en Meta** con base
    `https://nitro-bot-coral.vercel.app/r/c/` antes de activar.
  - **Carritos — entrega real (`lib/carts/delivery.ts`)**: los `failed` de
    Meta solo se logueaban; nadie los procesaba. Ahora `extractTrackedStatuses`
    (delivered + failed) → `processCartDeliveryStatus` correlaciona por wamid
    y actúa por código: **delivered** marca entrega (guard: nunca pisa un
    failed); **131049** (frecuencia de marketing) revierte UNA vez con
    reintento a 48h — **la única reversión de estado permitida** en la
    máquina, solo service_role y con tope `delivery_retries`; **131050** →
    opted_out + `marketing_opt_out`; **131026** → expired +
    `wa_undeliverable_at`. **Atribución honesta**: `recovered` exige
    recordatorio salido SIN fallo constatado (`reminderDelivered`) en los 3
    puntos de cierre — antes se contaba como venta recuperada un recordatorio
    que Meta descartó. Panel del cliente con el embudo
    enviado→entregado→click→recuperado; `/admin/health` con «Entrega de
    plantillas (7 días)» por cliente; alerta Telegram en el cron diario de
    billing (>15% de fallo con ≥10 envíos del día Bogotá **cerrado**: los
    failed llegan async tras el barrido).
  - **Tickets — avisos in-app (migración #35)**: el worker guardaba el mensaje
    del cliente escalado pero **no tocaba `tickets`**, así que nadie se
    enteraba sin abrir chat por chat. `tickets.last_customer_message_at` +
    `has_unread` (default true = un escalado nace sin leer; los existentes se
    apagaron en la migración); el worker los marca en el gate de estado
    (post-debounce) y **el Realtime de tickets ya existente** reordena la
    lista y enciende el badge sin canal nuevo. Lista ordenada por última
    actividad, punto `--brand` + «Mensaje nuevo», abrir el ticket lo limpia
    (`markTicketRead`). **Badge ámbar con contador en el sidebar**
    (`tickets-badge.tsx`, suscripción propia porque el canal de la página
    solo vive ahí; RLS filtra el count por rol).
  - **Tickets — reasignar a otro agente**: selector «Todo el equipo / …»
    junto a Resolver, con confirmación. OJO: `reassignTicket` valida
    visibilidad y destinatario por RLS pero **escribe con service_role**
    acotado a `(id, tenant)` — con el cliente authenticated, Postgres
    rechaza **42501** el UPDATE que saca la fila de la visibilidad de quien
    reasigna (el WITH CHECK de 0024 pasa, pero el SELECT de 0030 ya no), que
    es justo lo que pasa al pasarle el ticket a un compañero.
  - **Blocklist (migración #36)**: `blocked_numbers` (unique `(tenant_id,
    phone)` = índice del lookup), RLS patrón 0021 (todo el equipo lee, solo
    el **admin del tenant** escribe; REVOKE + grants por columna). El gate
    del worker va **antes de todo** (ni `markAsRead` —los checks azules
    delatarían el procesamiento—, ni conversación, ni CRM, ni mensaje, ni
    contador) y **gana sobre `test_phones`**. Cubre también recordatorios de
    silencio (Set por tenant), plantillas de carrito y la INGESTA de
    checkouts. Módulo `/dashboard/blocklist` («Bloqueados», solo admin,
    opt-out `modules.blocklist`) con `normalizeCoPhone` (misma normalización
    del canal) + botón «Bloquear número» en el detalle de Conversaciones.

### 🔜 Pendiente
- **Facturas + comprobantes + ROAS (Codex, 2026-07-24; MIGRADO Y
  DESPLEGADO, commit `066061d`)**: migración #38 agrega campos de comprobante en `invoices`,
  bucket privado `payment-proofs` y `marketing_investments` con RLS (equipo
  lee, solo admin escribe). El dashboard calcula vencimiento por
  `invoices.due_date`, muestra un rayo rojo arriba a la derecha y enlaza a
  facturas. Cada pendiente acepta JPG/PNG/WebP ≤3 MB; se guarda privada y se
  envía a Telegram con cliente/factura, sin marcarla pagada. Métricas permite
  registrar pauta por fecha/canal y muestra inversión, ROAS (ventas/inversión)
  y utilidad publicitaria estimada (ventas−pauta, explícitamente NO utilidad
  neta). Typecheck, lint dirigido, build, verify 4/4 y pruebas RLS verdes;
  datos de prueba revertidos. Deploy `Ready`, health OK, rutas protegidas y
  `sendPhoto` de Telegram probado con imagen técnica. Queda control visual con
  sesión real y primer comprobante real del cliente.
- **Datos de pago editables desde `/admin` (Codex, 2026-07-24; MIGRADO Y
  DESPLEGADO, commit `8ce6846`)**: migración #37 crea `platform_settings` global,
  solo-service_role, sembrada con los números actuales. Nuevo panel
  `/admin/settings/payments` permite cambiar titular y hasta 5 medios de pago;
  cada guardado verifica super-admin y audita solo etiquetas (no números).
  `/dashboard/plan` los carga server-side y conserva fallback a los valores
  anteriores si la migración todavía no existe. Typecheck, lint dirigido y
  build verdes; el lint global sigue fallando por 21 errores preexistentes en
  health/tickets/conversations. #37 aplicada: seed coincide con los números
  anteriores y anon queda bloqueado (`42501`). Deploy de producción `Ready`;
  health público OK y la ruta nueva redirige a login sin sesión. Falta solo
  prueba visual admin→dashboard cambiando/restaurando un valor.
- **Desplegar la rama `feature/tickets-blocklist-carts` (2026-07-22)**: las
  migraciones #34-#36 YA están aplicadas en la DB viva (todas aditivas, el
  código actual las ignora), así que el merge a main es el único paso que
  falta. Post-deploy: (1) mandar un mensaje desde el número de prueba a una
  conversación escalada → badge del sidebar sube en vivo y la lista se
  reordena; (2) reasignar un ticket real a otro agente y confirmar que
  desaparece de la bandeja de los demás; (3) bloquear un número de prueba →
  escribir desde él → CERO filas nuevas en `messages`/`conversations`;
  (4) revisar el panel de Carritos con la columna «Entrega» tras un par de
  días de tráfico real.
- **Plantillas v2 de Meta para el checkout prellenado (2026-07-22)**: crear
  y hacer aprobar `carrito_recordatorio_1_v2`/`_2_v2` (mismos cuerpos, botón
  URL base `https://nitro-bot-coral.vercel.app/r/c/`, Marketing, es_CO).
  Aprobadas → en /admin poner los nombres nuevos y cambiar «Link del botón»
  a «Redirect prellenado». Probar el botón en Android **y** iPhone antes de
  dejarlo: debe abrir el checkout con productos Y datos del cliente y poblar
  `clicked_at`. Rollback = volver el selector a «Token».
- **Post-deploy videos (2026-07-21)**: (1) Juan re-prueba enviar el video MP4
  desde Tickets (ya con subida directa a Storage); (2) Elegance sube un video
  a un producto en su admin de Shopify → el webhook products/update lo
  sincroniza solo → pedirle video al bot por WhatsApp ("¿tienes video de X?")
  y confirmar que llega; (3) avisar a Elegance de las 3 novedades (mensaje ya
  redactado en la sesión: tickets de video visibles para todos, envío de
  videos desde Tickets, videos de producto).
- **Prueba en vivo del modo gracia + suspensión + excedente (DESPLEGADO
  2026-07-19, push c9d1436, health OK)**: ver el badge y el botón «Suspender
  bot por pago» en /admin, suspender/reactivar un tenant de prueba, y
  confirmar que el cron diario de las 11:00 UTC reporta `alerts` en la
  respuesta. La pausa automática por agotar ciclo YA NO existe en producción.
- **Activar carritos abandonados para Elegance (Spec 13, post-deploy)**:
  (1) HECHO (2026-07-18): toggle ON y base
  `https://elegancecolombia.com/checkouts/cn/` configurada; (2) e2e real: abandonar un checkout con teléfono en la tienda →
  fila `pending` en /dashboard/carts → a los ~60 min (en ventana 8-20 Bogotá)
  llega la plantilla → responder «BAJA» debe contestar el texto fijo y marcar
  `opted_out`; (3) confirmar en el admin de Shopify de Elegance que la
  automatización NATIVA de correos de checkout abandonado está apagada (a
  17-jul los checkouts decían correo "No enviado") — si está activa es
  decisión comercial canal único o doble; (4) revisar `wa_template_usage` en
  event_log como base de facturación del módulo y vigilar el quality rating
  del número en Meta los primeros días; (5) OJO: la tienda DEV
  (`.myshopify.com`) nunca va a calzar con la base de producción — para
  probar desde la tienda dev, poner temporalmente su dominio como base (el
  link del botón saldrá roto a propósito, apunta al dominio real).
- **Vigilar el ciclo de Elegance (facturación activa desde 2026-07-17)**:
  contador ~6.444/7.000 al 2026-07-19 (adicional en uso), renovación $480k
  PENDIENTE (+ manual $80k), adicional $120k ya PAGADA, corte 2026-08-12. Al
  pago real: «Marcar pagada» la renovación — el ciclo nuevo arranca con el
  excedente de gracia descontado (si consumió p. ej. 7.350, arranca en 350).
  Tras el deploy del modo gracia, al agotar los 7.000 el bot SIGUE
  respondiendo: la pausa es el botón «Suspender bot por pago» en /admin
  (decisión de Juan).
  Confirmar que el cron diario `/api/cron/billing` corre (Vercel, 11:00 UTC).
- **Post-deploy specs A-D (2026-07-17)**: (1) poner NOMBRE a los usuarios de
  Elegance desde /admin → detalle del cliente; (2) responder un ticket real y
  ver «{nombre} · hora» en la burbuja; (3) login con un agente real y
  confirmar que su bandeja filtra estricto (sin etiquetas = solo «Sin
  etiqueta» — avisar a Elegance del cambio de regla: antes veían todo);
  (4) filtrar Métricas por un rango de fechas y cotejar contra Shopify;
  (5) tras unos días, revisar /dashboard/searches con demanda real y calibrar
  el umbral 0.45; (6) abrir la política en /dashboard/legal y mandarla a
  revisión legal.
- **Post-deploy fotos+etiquetas (2026-07-15)**: (1) por WhatsApp real pedir un
  producto → 1 foto; seguir chateando → no repite; "más fotos" → manda las que
  faltan; (2) escalar un caso real → ticket con etiqueta visible en
  /dashboard/tickets; (3) como admin de Elegance abrir `/dashboard/labels`,
  asignar etiquetas a un agente y confirmar que su bandeja filtra (los sin
  etiqueta se ven siempre); (4) avisar a Elegance que existe el módulo.
- **Avisar a Elegance: corregir precio al cliente de la conv `acc0f1e7…`**
  (el repo es público: NO poner aquí su teléfono/nombre; búscalo por el id en
  la DB o en Conversaciones) — el bot le dijo $155.000 por el trípode Q185
  pero vale $180.000 (mensaje corrupto del 2026-07-14 02:34 UTC, bug ya
  arreglado). La conversación sigue `bot_active`; si confirma, la orden
  saldría por el precio real ($180.000), distinto a lo prometido.
- **Configurar la facturación de Elegance en /admin** (card «Plan y
  facturación»): fecha de corte real, estado, y precio del paquete adicional
  de 2.000 mensajes; revisar que `monthly_fee` y `message_limit` (5.000)
  estén al día en «Datos del cliente». Sin fecha de corte el módulo muestra
  "—" y el banner solo salta por consumo ≥80%.
- **Cancelar en Shopify los pedidos dobles ya creados** (decide el cliente cuál
  conservar): conv `d6107e00` → `8944322511154`, `8944323723570`,
  `8944323887410` (la vigente parece `8944324903218`, $117.900); pares
  idénticos `8944163324210`/`8944164929842` ($128.000) y
  `8941868908850`/`8941871563058` ($73.000) → cancelar uno de cada par.
- **Post-deploy 2026-07-14**: (1) mandar un VIDEO real por WhatsApp → enlatado
  + ticket `video_recibido` + video reproducible en Tickets/Conversaciones;
  (2) orden de prueba + corrección después ("cámbiame la dirección") → NO se
  crea 2ª orden, escala `cambio_en_orden` (cancelar la orden de prueba);
  (3) a las 48h, query de `orders` agrupada por `conversation_id` → cero
  duplicados nuevos; vigilar `stale_reply_dropped` en /admin/health.
- **Control post-deploy spec 11 (24h)**: en `/admin/health` → "Tokens Gemini"
  (o query a `event_log` kind `gemini_usage` agrupada por `detail->>'source'`),
  `reminder` debe registrar `thoughtsTokens ≈ 0` con mensajes de calidad
  normal; `whatsapp` sin cambios (~1,8-2,0 thinking/salida).
- **Confirmar con el cliente Elegance que ya escucha los audios** en
  `/dashboard/conversations` desde su navegador real (si era Safari/iPhone
  aplica el fallback WAV; si era el bug de Realtime, el reproductor ya aparece
  en vivo).
- **Probar «Solicitudes» e2e en producción**: crear solicitud como usuario de
  Elegance dev → badge en /admin → aprobar con fecha → correo → responder →
  rechazar (exige motivo) → cierre propio. El correo requiere
  `tenants.notification_email` configurado en /admin.
- **Probar respuestas de voz en vivo**: activar el checkbox premium para
  Elegance dev en /admin y mandar una nota de voz real por WhatsApp (debe volver
  nota de voz con la voz de Mistral; texto después debe volver a texto). Opcional:
  botón "Probar voz" en /admin para validar un voice_id antes de guardarlo.
- **Loggear la respuesta vacía de Gemini a event_log** (worker `runAssistant
  sin texto`, hoy solo `console.error`): 6 casos el 2026-07-11, uno dejó a un
  cliente colgado. Evento warning con conversation_id para verlo en
  /admin/health.
- **Leer "Tokens Gemini" en /admin/health tras unos días de uso real** para
  medir el efecto del deploy 2befe98 (prompt/turno debe bajar en conversaciones
  largas) y decidir si duele: placeholder de media en rondas 2+ (única
  candidata restante; MAX_HISTORY ya se bajó a 20).
- **Re-ensayo del cierre de orden** por WhatsApp: la orden debe salir con envío
  $18.000 (o gratis ≥$199.000). Cancelar en Shopify dev la orden del ensayo que
  quedó con $15.000.
- **Post-deploy de los 7 ajustes**: llenar **"Información de la empresa"** en
  /admin para Elegance (garantías/envíos reales), probar foto+texto por
  WhatsApp real, y cancelar la orden de prueba **#133910** en Shopify dev.
- **Vigilar el cron horario de recordatorios**: el deploy lo aceptó, pero
  confirmar al día siguiente que hay eventos `reminder` en event_log
  (/admin/health). Si el plan de Vercel lo limita a diario, disparar
  `/api/cron/reminders` desde cron-job.org con el Bearer del CRON_SECRET.
- **Resend con dominio propio**: verificar dominio en Resend y cambiar
  `NOTIFY_FROM_EMAIL` (hoy `onboarding@resend.dev` solo entrega al correo del
  dueño de la cuenta).
- **Activar Telegram (Feature C YA construida, 2026-07-14)**: Juan crea el bot
  con @BotFather, corre `npm run telegram:test` para sacar su chat_id, y carga
  `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` en `.env.local` y Vercel Production.
  Sin las vars todo es no-op. Probar: `telegram:test` (✅ de conexión) y un
  `logEvent` de error de prueba.
- **Spec 07 diferida**: Feature H (backup semanal a Drive). Features C
  (Telegram) y D (Resend) YA están hechas.
- **Probar en vivo spec 07 y 08** (escalado por fallo, /admin/health, probador,
  flujo OAuth completo con una app del Dev Dashboard). Vercel opcional:
  `META_APP_ID` (subida de la foto de perfil de WhatsApp en el alta).
- **Probar v2 en vivo**: alta de un cliente dev con el botón (9 pasos en verde),
  multimedia (audio entrante visible, foto de producto saliente, agente enviando
  foto/audio), conversaciones en vivo y métricas de producto.
- **Verificación de negocio en Meta**: destraba el tope de 2→20 números. Por cada
  número nuevo, Meta revisa el display name (trámite aparte).
- **Inventory-level webhook** (opcional): `inventory_levels/update` necesita un
  handler aparte (su payload trae `inventory_item_id`, no el product id). Hoy el
  stock se refresca vía `products/update`.
- **Activación a producción de Elegance** (operativo, requiere cuentas reales):
  1. App Shopify de producción → nuevo tenant_secret (token+secret) vía `seed:tenant`;
     `backfill:catalog` y `register:shopify-webhooks` contra el dominio real.
  2. Número de WhatsApp de producción en Meta (Business verificado) → `seed:wa` con
     el `phone_number_id` y token de larga duración reales; re-suscribir el webhook.
  3. Crear usuarios del dashboard (desde /admin o `seed:dashboard-user`); las
     env vars de Vercel ya están cargadas.
  4. `npm run verify` apuntando al tenant de producción; smoke test e2e (mensaje
     real → respuesta, orden COD de prueba) y revisar `/api/health`.

> Plan completo: `~/.claude/plans/splendid-cuddling-candy.md`.

---

## Estructura del código

```
app/api/webhooks/shopify/route.ts   webhook catálogo (HMAC + after())
app/api/webhooks/meta/route.ts      webhook WhatsApp (handshake + firma + encola)
app/api/cron/reset-counters/route.ts  cron mensual del contador (CRON_SECRET)
app/api/cron/reminders/route.ts     cron horario de recordatorios (CRON_SECRET)
app/api/cron/cart-reminders/route.ts  cron 15min carritos abandonados (CRON_SECRET)
lib/carts/settings.ts               config del módulo por tenant (cart_settings + defaults)
lib/carts/checkouts.ts              ingesta webhooks checkouts/* + cierre por orders/create
lib/carts/reminders.ts              barrido de plantillas (reglas duras + telemetría)
lib/carts/optout.ts                 detección/aplicación de «BAJA» (marketing opt-out)
app/dashboard/carts/page.tsx        módulo «Carritos» del cliente (solo lectura)
app/api/health/route.ts             health check (app + DB)
app/api/dev/chat/route.ts           endpoint interno de prueba del asesor (dev)
lib/queue.ts                        cola de fondo (after() hoy, QStash después)
lib/whatsapp/meta.ts                Cloud API: enviar/leer/descargar media + parsing
lib/ai/worker.ts                    procesa entrante (idempotencia/debounce/gate/IA)
lib/ai/reminders.ts                 follow-ups (máx 2, ventana 24h, Gemini sin tools)
lib/ai/escalation.ts                escalado único a humano (ticket + correo)
lib/ai/tts.ts                       TTS Mistral Voxtral (respuestas de voz, best-effort)
lib/audio/ogg-to-wav.ts             transcode OGG/Opus→WAV (audios en Safari, WASM)
app/dashboard/message-body.tsx      cuerpo de mensaje compartido (texto/imagen/audio + canPlayType)
lib/notify/email.ts                 correos al equipo del cliente (Resend REST)
app/login/page.tsx                  login del dashboard (Server Action)
app/actions/auth.ts                 signIn/signOut (Server Actions)
app/dashboard/layout.tsx            layout protegido + nav por módulos
app/dashboard/page.tsx              Inicio: consumo del mes (alerta 80%)
app/dashboard/metrics/page.tsx      métricas (conversaciones, órdenes, ventas)
app/dashboard/crm/(page|export)     CRM + exportación CSV (RLS)
app/dashboard/conversations/*       conversaciones en vivo (solo lectura, Realtime, buscador ?q=)
app/dashboard/media/[id]/route.ts   sirve media del bucket privado (firma URL, RLS)
app/dashboard/tickets/*             tickets en vivo (responder/resolver + enviar foto/audio)
app/dashboard/requests/*            «Solicitudes» del cliente (crear/comentar/cerrar, RLS)
app/admin/requests/*                bandeja de Solicitudes (estado/eta/responder, audita)
lib/support/labels.ts               vocabulario compartido de Solicitudes (estados/categorías/badges)
app/admin/*                         Panel de Plataforma (super-admin): clientes,
                                    alta con un botón, detalle, resumen, actions
lib/admin/context.ts                gate super-admin (service_role, NO RLS) + audit_log
lib/provisioning/*                  aprovisionamiento compartido CLI↔panel (provisionTenant)
lib/storage.ts                      Storage: media privada (firmar URL) + logo público
proxy.ts                            Next 16: refresca sesión + protege /dashboard y /admin
lib/dashboard/context.ts            resuelve usuario→tenant (RLS) del dashboard
lib/supabase/server.ts              cliente SSR authenticated (RLS) del dashboard
lib/supabase/client.ts              cliente de navegador (Realtime)
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
lib/shopify/orders.ts               crea orden COD (orderCreate, PENDING, customer+province)
lib/shopify/colombia.ts             ciudad→departamento + códigos ISO (provinceCode)
scripts/migrate.mjs                 runner de migraciones (pg directo)
scripts/seed-tenant.ts              alta de tenant con creds cifradas (tsx)
scripts/seed-wa.ts                  carga creds WhatsApp del tenant (token cifrado)
scripts/register-shopify-webhooks.ts  registra webhooks products/* (idempotente)
scripts/seed-dashboard-user.ts      alta de usuario del dashboard (auth + app_users)
scripts/verify.ts                   suite de verificación (RAG + fuga RLS)
scripts/backfill-catalog.ts         carga inicial del catálogo (tsx)
vercel.json                         crons: reseteo mensual + recordatorios horario
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
WEBHOOK_BASE_URL=https://...vercel.app npm run register:shopify-webhooks
SEED_USER_EMAIL=... SEED_USER_PASSWORD=... npm run seed:dashboard-user
SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npm run seed:platform-admin  # 1er super-admin
npm run verify              # suite de verificación (RAG + fuga RLS, no muta)
npx tsc --noEmit            # typecheck
```

## Depuración: "el bot no responde"

El webhook responde 200 OK aunque el procesamiento de fondo falle, así que un 200
en los logs NO significa que el bot contestó. El worker tiene varios `return`
silenciosos (idempotencia, debounce, gate, **respuesta vacía de Gemini**). Orden
de revisión:

1. **¿Llegó el mensaje?** `messages` debe tener la fila `sender='customer'`. Si
   está, el webhook entregó y el worker corrió al menos hasta el insert.
2. **¿Hay respuesta del bot?** Busca `sender='bot'` posterior. Si no hay y NO hay
   error en los logs de Vercel → el worker hizo un `return` silencioso.
3. **Estado de la conversación**: si `conversations.status != 'bot_active'`
   (`requires_human`/`human_active`/`closed`), el bot calla **a propósito** hasta
   que un humano resuelva el ticket en `/dashboard/tickets` (vuelve a `bot_active`).
4. **Contador**: `current_month_messages` vs `message_limit` (corte al límite).
5. **Respuesta vacía de Gemini**: reproduce `runAssistant` con el historial real;
   si `text` viene `""`, casi siempre es que el `contents` termina en turno del
   modelo (ver nota de Gemini 3.x arriba). `finishReason STOP` + 0 tokens de
   salida lo confirma.

Errores reales del trabajo de fondo se loguean como `[queue] tarea de fondo
falló` (nivel error en Vercel). Su ausencia + sin respuesta = `return` silencioso,
no excepción.

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
