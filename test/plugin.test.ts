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

  it('responde 429 al superar el cupo (store en memoria)', async () => {
    const app = await appWithLayer({
      include: ['/saludo'],
      rateLimit: { byProfile: { free: 2 }, timeWindowMs: 60_000, banThreshold: 100 },
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
      plan: 'free',
    });
    const bob = jwtWith({
      iss: jwt.issuer,
      aud: jwt.audience,
      sub: 'user-bob',
      preferred_username: 'bob',
      plan: 'free',
    });
    const app = await appWithLayer({
      include: ['/saludo'],
      jwt,
      rateLimit: { byProfile: { free: 1 }, timeWindowMs: 60_000, banThreshold: 100 },
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
});
