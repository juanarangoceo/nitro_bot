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

### 🔜 Pendiente
- **Probar «Solicitudes» e2e en producción**: crear solicitud como usuario de
  Elegance dev → badge en /admin → aprobar con fecha → correo → responder →
  rechazar (exige motivo) → cierre propio. El correo requiere
  `tenants.notification_email` configurado en /admin.
- **Probar respuestas de voz en vivo**: activar el checkbox premium para
  Elegance dev en /admin y mandar una nota de voz real por WhatsApp (debe volver
  nota de voz con la voz de Mistral; texto después debe volver a texto). Opcional:
  botón "Probar voz" en /admin para validar un voice_id antes de guardarlo.
- **Leer "Tokens Gemini" en /admin/health tras unos días de uso real** para
  atribuir el gasto (whatsapp vs tester vs voz) y decidir optimizaciones
  (candidatas si duele: placeholder del audio en rondas 2+, bajar MAX_HISTORY).
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
- **Spec 07 diferidas**: Feature C (Telegram `lib/notify/telegram.ts` +
  `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`) y Feature H (backup semanal a
  Drive). Feature D (Resend) YA está hecha. Engancharlas en
  `lib/ai/escalation.ts` (punto único de tickets) y `event_log`.
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
app/api/health/route.ts             health check (app + DB)
app/api/dev/chat/route.ts           endpoint interno de prueba del asesor (dev)
lib/queue.ts                        cola de fondo (after() hoy, QStash después)
lib/whatsapp/meta.ts                Cloud API: enviar/leer/descargar media + parsing
lib/ai/worker.ts                    procesa entrante (idempotencia/debounce/gate/IA)
lib/ai/reminders.ts                 follow-ups (máx 2, ventana 24h, Gemini sin tools)
lib/ai/escalation.ts                escalado único a humano (ticket + correo)
lib/ai/tts.ts                       TTS Mistral Voxtral (respuestas de voz, best-effort)
lib/notify/email.ts                 correos al equipo del cliente (Resend REST)
app/login/page.tsx                  login del dashboard (Server Action)
app/actions/auth.ts                 signIn/signOut (Server Actions)
app/dashboard/layout.tsx            layout protegido + nav por módulos
app/dashboard/page.tsx              Inicio: consumo del mes (alerta 80%)
app/dashboard/metrics/page.tsx      métricas (conversaciones, órdenes, ventas)
app/dashboard/crm/(page|export)     CRM + exportación CSV (RLS)
app/dashboard/conversations/*       conversaciones en vivo (solo lectura, Realtime)
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
