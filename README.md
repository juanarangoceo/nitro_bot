# Nitro Bot

SaaS multi-tenant de ventas y atención por WhatsApp para tiendas Shopify. El asesor usa Gemini y el catálogo real de cada tienda para recomendar, atender, escalar y crear órdenes contraentrega.

## Documentación

- [Arquitectura](docs/architecture.md)
- [Seguridad y tenants](docs/security-and-tenancy.md)
- [Desarrollo y despliegue](docs/development-and-deployment.md)
- [Operaciones y estado](docs/operations-and-status.md)
- [Índice de módulos](docs/modules/README.md)

`CLAUDE.md` conserva la bitácora histórica detallada. `AGENTS.md` contiene reglas obligatorias para agentes.

## Inicio local

```bash
npm install
npm run dev
```

Antes de entregar un cambio: `npm run lint`, `npx tsc --noEmit` y `npm run build`. Aplicar migraciones y desplegar requieren decisiones separadas.
