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
});
