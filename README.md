# `@edgargmaya/fastify-layer`

Plugin Fastify 5 (`fastify-plugin`): no define rutas. La app inyecta `LayerOptions` y sigue siendo dueña de sus endpoints, **incluidos los nombres y cupos de plan**.

```bash
pnpm add @edgargmaya/fastify-layer
```

Cupo único (sin planes). `include` sigue siendo igualdad exacta y **un solo contador** para todos esos pathnames:

```ts
await app.register(fastifyLayer, {
  include: ['/saludo'],
  jwt: { issuer: 'urn:serverless:auth', audience: 'urn:serverless:saludo-api' },
  keyParts: ['username', 'ip'],
  rateLimit: { max: 40, window: 'minute' },
});
```

Cupo y ventana por ruta. El `url` es el patrón de Fastify (`request.routeOptions.url`), prefijo incluido. `/prefijo1/:idCliente` cubre `/prefijo1/acme` y `/prefijo1/bob` con el mismo cupo. Una regla sin `rateLimit` hereda el global. Una ruta que no esté en `routes` ni en `include` queda fuera.

```ts
await app.register(fastifyLayer, {
  jwt: { issuer: 'urn:serverless:auth', audience: 'urn:serverless:saludo-api' },
  rateLimit: { max: 30, window: 'hour' },
  routes: [
    { url: '/saludo' },
    { url: '/prefijo1/:idCliente', rateLimit: { max: 10, window: 'minute' } },
    {
      url: '/login/:clientId',
      rateLimit: { max: 3, window: 'minute' },
    },
  ],
});
```

Registra el plugin **antes** que las rutas. Cada regla tiene una sola ventana: la unidad es `minute`, `hour` o `day`, y `every` dice cuántas. `'minute'` es 1 minuto. `{ unit: 'minute', every: 5 }` son 5 minutos, así que `max: 5` es 5 requests cada 5 minutos. `{ unit: 'hour', every: 8 }` con `max: 500` es 500 cada 8 horas. No hay dos ventanas a la vez. En la clave Redis el patrón va al final (`alice:1.2.3.4:/prefijo1/:idCliente`), así que cada regla tiene su cubeta. `include` no añade ese segmento.

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
    window: 'minute',
  },
});
```

Si hay `plans`, hace falta `defaultPlan` (sin JWT, claim vacío o valor que no está en el mapa). Los nombres se normalizan a minúsculas. El claim del JWT es configurable (`planClaim`, default `plan`).

```text
request
  → onRequest: exclude → routes (patrón Fastify) o include
  → decodeJwt (iss/aud) → identidad
  → @fastify/rate-limit (Redis o memoria), una ventana por clave
  → handler de la app
```

Sin `redis`, el cupo es **in-memory** (una instancia: tests / desarrollo). Con Redis, todas las instancias comparten el contador.

La firma del JWT la valida quien autentique la petición (por ejemplo un Lambda Authorizer). Esta capa **decodifica** el payload (`jose.decodeJwt`) para la clave; no llama a JWKS.

## Estructura

```text
src/
  config.ts      LayerOptions + resolveRateLimit
  match.ts       include / exclude / routes
  identity.ts    Bearer → { sub, username, plan, iss }
  key.ts         keyParts → string Redis
  redis.ts       ioredis singleton (lazyConnect)
  plugin.ts      hooks + @fastify/rate-limit
```

## Opciones

| Campo | Rol |
|-------|-----|
| `include` / `exclude` | Pathnames exactos. `include` comparte cubeta. `exclude` gana, también sobre un patrón |
| `routes` | `{ url, rateLimit? }`. `url` = patrón Fastify. Sin `rateLimit`, usa el global |
| `routes[].rateLimit.window` | `'minute'` (1 minuto) o `{ unit: 'minute' \| 'hour' \| 'day', every: 5 }`. Una por regla |
| `redis` | `host`, `port`, `password`, `tls` |
| `jwt` | `issuer`, `audience`. `usernameClaim` elige el username de la clave: default `preferred_username`, `email`, `nickname`; si ninguno viene, `sub` |
| `keyParts` | default `username`, `ip` (añade `plan` si usas catálogo) |
| `rateLimit.max` | Cupo único si no hay `plans` (default 10). Lo heredan las reglas que no traen máximo |
| `rateLimit.plans` | Mapa `nombre → máximo` definido por la app |
| `rateLimit.defaultPlan` | Obligatorio con `plans` |
| `rateLimit.planClaim` | Claim JWT (default `plan`) |
| `rateLimit.window` | Unidad y cuántas: `'hour'` o `{ unit: 'hour', every: 8 }`. Default: 1 minuto. `timeWindowMs` sigue valiendo si no hay `window` |
| `rateLimit` | también `skipOnError`, `banThreshold`, `nameSpace` (globales; una regla no los cambia) |

429 al superar el cupo; ban → 403. Cabeceras `x-ratelimit-*`. Sigue `x-serverless-layer: 1`.

```bash
pnpm install && pnpm test && pnpm build
```
