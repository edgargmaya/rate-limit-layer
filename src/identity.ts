import { decodeJwt } from 'jose';
import type { FastifyRequest } from 'fastify';
import type { JwtOptions, UserPlan } from './config.js';

export type RequestIdentity = {
  sub: string;
  username: string;
  plan: UserPlan;
  iss: string;
};

function extractBearer(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  if (!authorization.toLowerCase().startsWith('bearer ')) return undefined;
  const token = authorization.slice(7).trim();
  return token.length > 0 ? token : undefined;
}

function audienceOf(aud: unknown): string[] {
  if (typeof aud === 'string') return [aud];
  if (Array.isArray(aud)) return aud.filter((v): v is string => typeof v === 'string');
  return [];
}

function resolvePlan(raw: unknown): UserPlan {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'premium' ? 'premium' : 'free';
}

const anonymous: RequestIdentity = {
  sub: 'anonymous',
  username: 'anonymous',
  plan: 'free',
  iss: '',
};

/**
 * Identidad para la clave Redis. API Gateway ya validó la firma;
 * aquí solo se decodifica el payload (sin red / JWKS) y se filtra iss/aud.
 */
export function identityFromRequest(request: FastifyRequest, jwt?: JwtOptions): RequestIdentity {
  const token = extractBearer(
    typeof request.headers.authorization === 'string' ? request.headers.authorization : undefined,
  );
  if (!token) return anonymous;

  try {
    const payload = decodeJwt(token);
    if (jwt?.issuer && payload.iss !== jwt.issuer) return anonymous;
    if (jwt?.audience && !audienceOf(payload.aud).includes(jwt.audience)) return anonymous;

    const sub = typeof payload.sub === 'string' && payload.sub ? payload.sub : 'anonymous';
    const username =
      typeof payload.preferred_username === 'string' && payload.preferred_username
        ? payload.preferred_username
        : sub;
    return {
      sub,
      username,
      plan: resolvePlan(payload.plan),
      iss: typeof payload.iss === 'string' ? payload.iss : '',
    };
  } catch {
    return anonymous;
  }
}
