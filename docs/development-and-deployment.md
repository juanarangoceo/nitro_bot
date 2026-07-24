# Desarrollo y despliegue

## Antes de modificar

1. Leer `AGENTS.md` y revisar `git status --short`.
2. Preservar trabajo ajeno y archivos no rastreados.
3. Leer la guía pertinente de Next.js 16.
4. Localizar módulo, migraciones y consumidores.
5. Definir impacto en tenants, webhooks, cron y clientes.

## Validación

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run migrate:status
npm run verify
```

`npm run verify` comprueba secretos, RAG, contador y aislamiento RLS. Usa un usuario desechable; no es estrictamente read-only.

## Migraciones

- Nunca modificar una migración aplicada.
- Crear una migración consecutiva y preferentemente aditiva.
- Separar migración, deploy y activación.
- Versionar Storage y Realtime.
- No eliminar datos o políticas sin transición y rollback.

## Topología documentada

- GitHub: `github.com/juanarangoceo/nitro_bot`.
- Vercel: `seller360grados-projects/nitro-bot`.
- URL: `https://nitro-bot-coral.vercel.app`.
- Supabase ref: `snbxdzytpwibctepuiwq`.

Estos valores vienen de la bitácora. Antes de operar producción se verifican remoto, rama, vínculo local, sesión CLI y entorno.

Crear código, aplicar migración, commit, push, deploy y activación son acciones distintas. Ninguna autoriza implícitamente la siguiente.

## Estados de entrega

Registrar por separado: implementado, validado localmente, migrado, probado con tenant dev, desplegado, activado y verificado en producción.

## Rollback

- Código: desplegar versión conocida.
- Función: desactivar por tenant.
- Datos: preferir migraciones compatibles con código anterior.
- Revertir código no revierte una migración.
