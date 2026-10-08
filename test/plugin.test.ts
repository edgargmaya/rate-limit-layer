import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { fastifyLayer, type LayerOptions } from '../src/index.js';

function jwtWith(payload: object): string {
  const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${h}.${p}.sig`;
}

describe('@edgargmaya/fastify-layer', () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function appWithLayer(opts: LayerOptions = {}) {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(fastifyLayer, opts);
    app.get('/saludo', async () => ({ ok: true }));
    app.get('/health', async () => ({ status: 'ok' }));
    await app.ready();
    return app;
  }

  it('añade la cabecera por defecto en todas las rutas', async () => {
    const app = await appWithLayer();
    const res = await app.inject({ method: 'GET', url: '/saludo' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-serverless-layer']).toBe('1');
  });

  it('include limita las rutas afectadas', async () => {
    const app = await appWithLayer({ include: ['/saludo'] });
    const saludo = await app.inject({ method: 'GET', url: '/saludo?usuario=x' });
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(saludo.headers['x-serverless-layer']).toBe('1');
    expect(health.headers['x-serverless-layer']).toBeUndefined();
  });

  it('exclude gana sobre include implícito', async () => {
    const app = await appWithLayer({ exclude: ['/health'] });
    const saludo = await app.inject({ method: 'GET', url: '/saludo' });
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(saludo.headers['x-serverless-layer']).toBe('1');
    expect(health.headers['x-serverless-layer']).toBeUndefined();
  });

  it('permite personalizar nombre y valor de la cabecera', async () => {
    const app = await appWithLayer({
      include: ['/saludo'],
      headerName: 'x-custom-layer',
      headerValue: 'demo',
    });
    const res = await app.inject({ method: 'GET', url: '/saludo' });
    expect(res.headers['x-custom-layer']).toBe('demo');
    expect(res.headers['x-serverless-layer']).toBeUndefined();
  });

  it('responde 429 al superar el cupo único (store en memoria)', async () => {
    const app = await appWithLayer({
      include: ['/saludo'],
      rateLimit: { max: 2, timeWindowMs: 60_000, banThreshold: 100 },
    });
    expect((await app.inject({ method: 'GET', url: '/saludo' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/saludo' })).statusCode).toBe(200);
    const limited = await app.inject({ method: 'GET', url: '/saludo' });
    expect(limited.statusCode).toBe(429);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('aísla cupos por usuario del JWT', async () => {
    const jwt = { issuer: 'urn:serverless:auth', audience: 'urn:serverless:saludo-api' };
    const alice = jwtWith({
      iss: jwt.issuer,
      aud: jwt.audience,
      sub: 'user-alice',
      preferred_username: 'alice',
    });
    const bob = jwtWith({
      iss: jwt.issuer,
      aud: jwt.audience,
      sub: 'user-bob',
      preferred_username: 'bob',
    });
    const app = await appWithLayer({
      include: ['/saludo'],
      jwt,
      rateLimit: { max: 1, timeWindowMs: 60_000, banThreshold: 100 },
    });

    expect(
      (await app.inject({ method: 'GET', url: '/saludo', headers: { authorization: `Bearer ${alice}` } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/saludo', headers: { authorization: `Bearer ${alice}` } }))
        .statusCode,
    ).toBe(429);
    expect(
      (await app.inject({ method: 'GET', url: '/saludo', headers: { authorization: `Bearer ${bob}` } }))
        .statusCode,
    ).toBe(200);
  });

  it('sin preferred_username aísla el cupo por email', async () => {
    const jwt = { issuer: 'urn:serverless:auth', audience: 'urn:serverless:saludo-api' };
    const alice = jwtWith({
      iss: jwt.issuer,
      aud: jwt.audience,
      sub: 'auth0|67338e99a4f5c72ccad7ce71',
      email: 'alice@client.com',
    });
    const bob = jwtWith({
      iss: jwt.issuer,
      aud: jwt.audience,
      sub: 'auth0|6a1f0023bb12a0f0012ab399',
      email: 'bob@client.com',
    });
    const app = await appWithLayer({
      include: ['/saludo'],
      jwt,
      keyParts: ['username'],
      rateLimit: { max: 1, banThreshold: 100 },
    });

    expect(
      (await app.inject({ method: 'GET', url: '/saludo', headers: { authorization: `Bearer ${alice}` } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/saludo', headers: { authorization: `Bearer ${alice}` } }))
        .statusCode,
    ).toBe(429);
    expect(
      (await app.inject({ method: 'GET', url: '/saludo', headers: { authorization: `Bearer ${bob}` } }))
        .statusCode,
    ).toBe(200);
  });

  it('aplica cupos distintos según el catálogo de planes de la app', async () => {
    const jwt = { issuer: 'urn:serverless:auth', audience: 'urn:serverless:saludo-api' };
    const starter = jwtWith({
      iss: jwt.issuer,
      aud: jwt.audience,
      sub: 'user-a',
      preferred_username: 'ana',
      plan: 'starter',
    });
    const pro = jwtWith({
      iss: jwt.issuer,
      aud: jwt.audience,
      sub: 'user-b',
      preferred_username: 'ben',
      plan: 'pro',
    });
    const app = await appWithLayer({
      include: ['/saludo'],
      jwt,
      keyParts: ['username', 'plan', 'ip'],
      rateLimit: {
        plans: { starter: 1, pro: 3 },
        defaultPlan: 'starter',
        timeWindowMs: 60_000,
        banThreshold: 100,
      },
    });

    expect(
      (await app.inject({ method: 'GET', url: '/saludo', headers: { authorization: `Bearer ${starter}` } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/saludo', headers: { authorization: `Bearer ${starter}` } }))
        .statusCode,
    ).toBe(429);

    expect(
      (await app.inject({ method: 'GET', url: '/saludo', headers: { authorization: `Bearer ${pro}` } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/saludo', headers: { authorization: `Bearer ${pro}` } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/saludo', headers: { authorization: `Bearer ${pro}` } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/saludo', headers: { authorization: `Bearer ${pro}` } }))
        .statusCode,
    ).toBe(429);
  });

  it('con max único ignora un claim plan del JWT', async () => {
    const jwt = { issuer: 'urn:serverless:auth', audience: 'urn:serverless:saludo-api' };
    const token = jwtWith({
      iss: jwt.issuer,
      aud: jwt.audience,
      sub: 'user-bob',
      preferred_username: 'bob',
      plan: 'premium',
    });
    const app = await appWithLayer({
      include: ['/saludo'],
      jwt,
      rateLimit: { max: 1, timeWindowMs: 60_000, banThreshold: 100 },
    });
    expect(
      (await app.inject({ method: 'GET', url: '/saludo', headers: { authorization: `Bearer ${token}` } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/saludo', headers: { authorization: `Bearer ${token}` } }))
        .statusCode,
    ).toBe(429);
  });

  it('falla al registrar si defaultPlan no está en plans', async () => {
    const app = Fastify({ logger: false });
    await expect(
      app.register(fastifyLayer, {
        rateLimit: { plans: { starter: 10 }, defaultPlan: 'missing' },
      }),
    ).rejects.toThrow(/defaultPlan/);
  });

  it('include comparte un solo cupo entre pathnames exactos', async () => {
    const app = await appWithLayer({
      include: ['/saludo', '/health'],
      rateLimit: { max: 1, banThreshold: 100 },
    });
    expect((await app.inject({ method: 'GET', url: '/saludo' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(429);
  });

  it('cada ruta de routes tiene su cupo y una ruta sin máximo usa el global', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(fastifyLayer, {
      rateLimit: { max: 2, window: 'minute', banThreshold: 100 },
      routes: [
        { url: '/saludo' },
        { url: '/health', rateLimit: { max: 1 } },
      ],
    });
    app.get('/saludo', async () => ({ ok: true }));
    app.get('/health', async () => ({ status: 'ok' }));
    app.get('/otro', async () => ({ ok: true }));
    await app.ready();

    expect((await app.inject({ method: 'GET', url: '/saludo' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/saludo' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/saludo' })).statusCode).toBe(429);

    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(429);

    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({ method: 'GET', url: '/otro' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-serverless-layer']).toBeUndefined();
    }
  });

  it('un path param agrupa los ids en el cupo de esa ruta', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(fastifyLayer, {
      rateLimit: { banThreshold: 100 },
      routes: [{ url: '/prefijo1/:idCliente', rateLimit: { max: 1, window: 'minute' } }],
    });
    app.get('/prefijo1/:idCliente', async () => ({ ok: true }));
    await app.ready();

    expect((await app.inject({ method: 'GET', url: '/prefijo1/acme' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/prefijo1/bob' })).statusCode).toBe(429);
  });

  it('el patrón con prefijo de Fastify es el url completo de la ruta', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(fastifyLayer, {
      rateLimit: { banThreshold: 100 },
      routes: [{ url: '/prefijo1/:idCliente', rateLimit: { max: 1 } }],
    });
    await app.register(
      async (scope) => {
        scope.get('/:idCliente', async () => ({ ok: true }));
      },
      { prefix: '/prefijo1' },
    );
    await app.ready();

    expect((await app.inject({ method: 'GET', url: '/prefijo1/acme' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/prefijo1/bob' })).statusCode).toBe(429);
  });

  it('exclude saca un pathname concreto aunque el patrón coincida', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(fastifyLayer, {
      exclude: ['/prefijo1/acme'],
      rateLimit: { banThreshold: 100 },
      routes: [{ url: '/prefijo1/:idCliente', rateLimit: { max: 1 } }],
    });
    app.get('/prefijo1/:idCliente', async () => ({ ok: true }));
    await app.ready();

    expect((await app.inject({ method: 'GET', url: '/prefijo1/acme' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/prefijo1/acme' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/prefijo1/bob' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/prefijo1/bob' })).statusCode).toBe(429);
  });

  it('la ventana hour se refleja en retry-after', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(fastifyLayer, {
      rateLimit: { banThreshold: 100 },
      routes: [{ url: '/saludo', rateLimit: { max: 1, window: 'hour' } }],
    });
    app.get('/saludo', async () => ({ ok: true }));
    await app.ready();

    expect((await app.inject({ method: 'GET', url: '/saludo' })).statusCode).toBe(200);
    const limited = await app.inject({ method: 'GET', url: '/saludo' });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(60);
  });

  it('every multiplica la unidad de la ventana', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(fastifyLayer, {
      rateLimit: { banThreshold: 100 },
      routes: [
        { url: '/saludo', rateLimit: { max: 5, window: { unit: 'minute', every: 5 } } },
      ],
    });
    app.get('/saludo', async () => ({ ok: true }));
    await app.ready();

    for (let i = 0; i < 5; i += 1) {
      expect((await app.inject({ method: 'GET', url: '/saludo' })).statusCode).toBe(200);
    }
    const limited = await app.inject({ method: 'GET', url: '/saludo' });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(299);
  });

  it('rechaza una ventana desconocida y un patrón duplicado', async () => {
    const badWindow = Fastify({ logger: false });
    await expect(
      badWindow.register(fastifyLayer, {
        routes: [{ url: '/saludo', rateLimit: { window: 'week' as 'minute' } }],
      }),
    ).rejects.toThrow(/window must be minute, hour, or day/);
    await badWindow.close();

    const duplicated = Fastify({ logger: false });
    await expect(
      duplicated.register(fastifyLayer, {
        routes: [{ url: '/saludo' }, { url: '/saludo' }],
      }),
    ).rejects.toThrow(/duplicate routes url/);
    await duplicated.close();

    const badClaim = Fastify({ logger: false });
    await expect(
      badClaim.register(fastifyLayer, { jwt: { usernameClaim: [''] } }),
    ).rejects.toThrow(/usernameClaim\[0\]/);
    await badClaim.close();
  });
});
