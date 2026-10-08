import { describe, expect, it } from 'vitest';
import { resolveRateLimit, resolveTimeWindowMs } from '../src/config.js';
import { identityFromRequest, resolvePlan } from '../src/identity.js';
import { buildRateLimitKey } from '../src/key.js';

function jwtWith(payload: object): string {
  const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${h}.${p}.sig`;
}

function req(authorization?: string) {
  return {
    headers: authorization ? { authorization } : {},
    ip: '203.0.113.10',
  } as import('fastify').FastifyRequest;
}

describe('resolveRateLimit', () => {
  it('usa max único cuando no hay plans', () => {
    const rl = resolveRateLimit({ max: 40 });
    expect(rl.plans).toBeUndefined();
    expect(rl.max).toBe(40);
    expect(rl.defaultPlan).toBe('default');
  });

  it('exige defaultPlan en el catálogo', () => {
    expect(() => resolveRateLimit({ plans: { starter: 10, pro: 50 } })).toThrow(/defaultPlan/);
    expect(() =>
      resolveRateLimit({ plans: { starter: 10 }, defaultPlan: 'pro' }),
    ).toThrow(/must exist in plans/);
  });

  it('traduce window a una sola duración', () => {
    expect(resolveTimeWindowMs({ window: 'minute' })).toBe(60_000);
    expect(resolveTimeWindowMs({ window: 'hour' })).toBe(3_600_000);
    expect(resolveTimeWindowMs({ window: 'day' })).toBe(86_400_000);
    expect(resolveTimeWindowMs({ window: { unit: 'minute', every: 5 } })).toBe(300_000);
    expect(resolveTimeWindowMs({ window: { unit: 'hour', every: 8 } })).toBe(28_800_000);
    expect(resolveTimeWindowMs({ window: { unit: 'day' } })).toBe(86_400_000);
    expect(resolveRateLimit({ max: 5, window: { unit: 'minute', every: 5 } }).timeWindowMs).toBe(300_000);
    expect(() => resolveTimeWindowMs({ window: 'minute', timeWindowMs: 1000 })).toThrow(/not both/);
    expect(() => resolveTimeWindowMs({ window: { unit: 'minute', every: 0 } })).toThrow(/window.every/);
  });

  it('normaliza nombres de plan a minúsculas', () => {
    const rl = resolveRateLimit({
      plans: { Starter: 10, PRO: 50 },
      defaultPlan: 'STARTER',
    });
    expect(rl.plans).toEqual({ starter: 10, pro: 50 });
    expect(rl.defaultPlan).toBe('starter');
  });
});

describe('identityFromRequest', () => {
  const jwt = { issuer: 'urn:serverless:auth', audience: 'urn:serverless:saludo-api' };
  const catalog = resolveRateLimit({
    plans: { free: 10, premium: 25 },
    defaultPlan: 'free',
  });

  it('es anonymous sin Bearer y usa defaultPlan', () => {
    expect(identityFromRequest(req(), jwt, catalog)).toMatchObject({
      username: 'anonymous',
      plan: 'free',
    });
  });

  it('lee preferred_username y plan del payload si está en el catálogo', () => {
    const token = jwtWith({
      iss: 'urn:serverless:auth',
      aud: 'urn:serverless:saludo-api',
      sub: 'user-bob',
      preferred_username: 'bob',
      plan: 'premium',
    });
    expect(identityFromRequest(req(`Bearer ${token}`), jwt, catalog)).toMatchObject({
      username: 'bob',
      plan: 'premium',
      sub: 'user-bob',
    });
  });

  it('cae a defaultPlan si el claim no está en el catálogo', () => {
    const token = jwtWith({
      iss: 'urn:serverless:auth',
      aud: 'urn:serverless:saludo-api',
      sub: 'user-bob',
      preferred_username: 'bob',
      plan: 'gold',
    });
    expect(identityFromRequest(req(`Bearer ${token}`), jwt, catalog).plan).toBe('free');
  });

  it('ignora un token con aud distinta', () => {
    const token = jwtWith({
      iss: 'urn:serverless:auth',
      aud: 'urn:other',
      sub: 'user-bob',
      preferred_username: 'bob',
    });
    expect(identityFromRequest(req(`Bearer ${token}`), jwt, catalog).username).toBe('anonymous');
  });

  it('sin preferred_username usa email y, si tampoco está, nickname', () => {
    const withEmail = jwtWith({
      iss: 'urn:serverless:auth',
      aud: 'urn:serverless:saludo-api',
      sub: 'auth0|aaa',
      email: 'alice@client.com',
      nickname: 'ali',
    });
    expect(identityFromRequest(req(`Bearer ${withEmail}`), jwt, catalog).username).toBe('alice@client.com');

    const nicknameOnly = jwtWith({
      iss: 'urn:serverless:auth',
      aud: 'urn:serverless:saludo-api',
      sub: 'auth0|bbb',
      nickname: 'bob',
    });
    expect(identityFromRequest(req(`Bearer ${nicknameOnly}`), jwt, catalog).username).toBe('bob');
  });

  it('sin claims de username deja el sub en la clave', () => {
    const token = jwtWith({
      iss: 'urn:serverless:auth',
      aud: 'urn:serverless:saludo-api',
      sub: 'auth0|67338e99a4f5c72ccad7ce71',
    });
    const identity = identityFromRequest(req(`Bearer ${token}`), jwt, catalog);
    expect(identity.username).toBe('auth0|67338e99a4f5c72ccad7ce71');
    expect(buildRateLimitKey(['username'], identity, '203.0.113.10', '/tenants/:tenantId')).toBe(
      'auth0|67338e99a4f5c72ccad7ce71:/tenants/:tenantId',
    );
  });

  it('usernameClaim de la app pisa el orden por defecto', () => {
    const token = jwtWith({
      iss: 'urn:serverless:auth',
      aud: 'urn:serverless:saludo-api',
      sub: 'auth0|ccc',
      preferred_username: 'bob',
      email: 'bob@client.com',
      'https://mi-app/email': 'bob@tenant.com',
    });
    expect(
      identityFromRequest(
        req(`Bearer ${token}`),
        { ...jwt, usernameClaim: ['https://mi-app/email', 'email'] },
        catalog,
      ).username,
    ).toBe('bob@tenant.com');
  });

  it('un claim vacío o en blanco cede al siguiente y una lista vacía cae a sub', () => {
    const token = jwtWith({
      iss: 'urn:serverless:auth',
      aud: 'urn:serverless:saludo-api',
      sub: 'auth0|ddd',
      preferred_username: '   ',
      email: 'd@client.com',
    });
    expect(identityFromRequest(req(`Bearer ${token}`), jwt, catalog).username).toBe('d@client.com');
    expect(
      identityFromRequest(req(`Bearer ${token}`), { ...jwt, usernameClaim: [] }, catalog).username,
    ).toBe('auth0|ddd');
  });

  it('rechaza un nombre de claim vacío', () => {
    expect(() => identityFromRequest(req(), { usernameClaim: [''] })).toThrow(/usernameClaim\[0\]/);
  });

  it('sin catálogo no usa el claim plan para el cupo (plan = default)', () => {
    const token = jwtWith({
      iss: 'urn:serverless:auth',
      aud: 'urn:serverless:saludo-api',
      sub: 'user-bob',
      preferred_username: 'bob',
      plan: 'premium',
    });
    expect(identityFromRequest(req(`Bearer ${token}`), jwt).plan).toBe('default');
  });
});

describe('resolvePlan', () => {
  const catalog = resolveRateLimit({
    plans: { starter: 20, pro: 100 },
    defaultPlan: 'starter',
  });

  it('acepta el claim aunque venga en otro case', () => {
    expect(resolvePlan('PRO', catalog)).toBe('pro');
  });
});

describe('buildRateLimitKey', () => {
  it('compone username:plan:ip', () => {
    expect(
      buildRateLimitKey(
        ['username', 'plan', 'ip'],
        { sub: 'user-alice', username: 'Alice', plan: 'free', iss: 'urn:serverless:auth' },
        '1.2.3.4',
      ),
    ).toBe('alice:free:1.2.3.4');
  });

  it('añade el patrón solo cuando la regla de ruta lo pide', () => {
    const identity = { sub: 'user-alice', username: 'Alice', plan: 'free', iss: 'urn:serverless:auth' };
    expect(buildRateLimitKey(['username', 'ip'], identity, '1.2.3.4', '/prefijo1/:idCliente')).toBe(
      'alice:1.2.3.4:/prefijo1/:idCliente',
    );
  });
});
