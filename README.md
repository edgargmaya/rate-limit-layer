# `@edgargmaya/fastify-layer`

Plugin Fastify 5 (`fastify-plugin`): no define rutas. La app inyecta `LayerOptions` y sigue siendo dueña de sus endpoints, **incluidos los nombres y cupos de plan**.

```bash
pnpm add @edgargmaya/fastify-layer
```

Cupo único (sin planes):

```ts
await app.register(fastifyLayer, {
  include: ['/saludo'],
  jwt: { issuer: 'urn:serverless:auth', audience: 'urn:serverless:saludo-api' },
  keyParts: ['username', 'ip'],
  rateLimit: { max: 40, timeWindowMs: 60_000 },
});
```

Varios planes definidos por la app:

```ts
await app.register(fastifyLayer, {
  include: ['/saludo'],
  redis: { host, port, password, tls: true },
  jwt: { issuer: 'urn:serverless:auth', audience: 'urn:serverless:saludo-api' },
  keyParts: ['username', 'plan', 'ip'],
  rateLimit: {
    plans: { free: 10, premium: 25 },
    defaultPlan: 'free',
    planClaim: 'plan',
    timeWindowMs: 60_000,
  },
});
```

Si hay `plans`, hace falta `defaultPlan` (sin JWT, claim vacío o valor que no está en el mapa). Los nombres se normalizan a minúsculas. El claim del JWT es configurable (`planClaim`, default `plan`).

```text
request
  → onRequest: include/exclude → decodeJwt (iss/aud) → identidad
  → @fastify/rate-limit (Redis o memoria)
  → handler de la app
```

Sin `redis`, el cupo es **in-memory** (una instancia: tests / desarrollo). Con Redis, todas las instancias comparten el contador.

La firma del JWT la valida quien autentique la petición (por ejemplo un Lambda Authorizer). Esta capa **decodifica** el payload (`jose.decodeJwt`) para la clave; no llama a JWKS.

## Estructura

```text
src/
  config.ts      LayerOptions + resolveRateLimit
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
| `keyParts` | default `username`, `ip` (añade `plan` si usas catálogo) |
| `rateLimit.max` | Cupo único si no hay `plans` (default 10) |
| `rateLimit.plans` | Mapa `nombre → máximo` definido por la app |
| `rateLimit.defaultPlan` | Obligatorio con `plans` |
| `rateLimit.planClaim` | Claim JWT (default `plan`) |
| `rateLimit` | también `timeWindowMs`, `skipOnError`, `banThreshold`, `nameSpace` |

429 al superar el cupo; ban → 403. Cabeceras `x-ratelimit-*`. Sigue `x-serverless-layer: 1`.

```bash
pnpm install && pnpm test && pnpm build
```
