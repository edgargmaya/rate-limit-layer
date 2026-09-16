import { describe, expect, it } from 'vitest';
import { resolveRateLimit } from '../src/config.js';
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
});
