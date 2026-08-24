# `@edgargmaya/fastify-layer`

Plugin Fastify 5 (`fastify-plugin`): no define rutas. La app inyecta `LayerOptions` y sigue siendo dueña de sus endpoints.

```bash
pnpm add @edgargmaya/fastify-layer
```

```ts
import Fastify from 'fastify';
import fastifyLayer from '@edgargmaya/fastify-layer';

const app = Fastify();
await app.register(fastifyLayer, {
  include: ['/saludo'],
  redis: { host, port, password, tls: true },
  jwt: { issuer: 'urn:serverless:auth', audience: 'urn:serverless:saludo-api' },
  keyParts: ['username', 'plan', 'ip'],
  rateLimit: { byProfile: { free: 10, premium: 25 }, timeWindowMs: 60_000 },
});
```

```text
request
  → onRequest: include/exclude → decodeJwt (iss/aud) → identidad
  → @fastify/rate-limit (Redis o memoria) clave username:plan:ip
  → handler de la app
```

Sin `redis`, el cupo es **in-memory** (una instancia: tests / desarrollo). Con Redis, todas las instancias comparten el contador.

La firma del JWT la valida quien autentique la petición (por ejemplo un Lambda Authorizer). Esta capa **decodifica** el payload (`jose.decodeJwt`) para la clave; no llama a JWKS.

## Estructura

```text
src/
  config.ts      LayerOptions
  match.ts       include / exclude
  identity.ts    Bearer → { sub, username, plan, iss }
  key.ts         keyParts → string Redis
  redis.ts       ioredis singleton (lazyConnect)
  plugin.ts      hooks + @fastify/rate-limit
```

## Opciones

| Campo | Rol |
|-------|-----|
| `include` / `exclude` | Pathnames |
| `redis` | `host`, `port`, `password`, `tls` |
| `jwt` | `issuer`, `audience` (filtro del payload) |
| `keyParts` | default `username`, `plan`, `ip` |
| `rateLimit` | `byProfile`, `timeWindowMs`, `skipOnError`, `banThreshold`, `nameSpace` |

429 al superar el cupo; ban → 403. Cabeceras `x-ratelimit-*`. Sigue `x-serverless-layer: 1`.

```bash
pnpm install && pnpm test && pnpm build
```
