import { describe, expect, it } from 'vitest';
import { identityFromRequest } from '../src/identity.js';
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

describe('identityFromRequest', () => {
  const jwt = { issuer: 'urn:serverless:auth', audience: 'urn:serverless:saludo-api' };

  it('es anonymous sin Bearer', () => {
    expect(identityFromRequest(req(), jwt).username).toBe('anonymous');
  });

  it('lee preferred_username y plan del payload', () => {
    const token = jwtWith({
      iss: 'urn:serverless:auth',
      aud: 'urn:serverless:saludo-api',
      sub: 'user-bob',
      preferred_username: 'bob',
      plan: 'premium',
    });
    expect(identityFromRequest(req(`Bearer ${token}`), jwt)).toMatchObject({
      username: 'bob',
      plan: 'premium',
      sub: 'user-bob',
    });
  });

  it('ignora un token con aud distinta', () => {
    const token = jwtWith({
      iss: 'urn:serverless:auth',
      aud: 'urn:other',
      sub: 'user-bob',
      preferred_username: 'bob',
    });
    expect(identityFromRequest(req(`Bearer ${token}`), jwt).username).toBe('anonymous');
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
