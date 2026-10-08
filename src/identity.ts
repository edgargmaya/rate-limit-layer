import { decodeJwt } from 'jose';
import type { FastifyRequest } from 'fastify';
import { usernameClaimsOf, type JwtOptions, type ResolvedRateLimit } from './config.js';

export type RequestIdentity = {
  sub: string;
  username: string;
  plan: string;
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

export function resolvePlan(raw: unknown, rateLimit: ResolvedRateLimit): string {
  if (!rateLimit.plans) return rateLimit.defaultPlan;
  if (typeof raw !== 'string') return rateLimit.defaultPlan;
  const name = raw.trim().toLowerCase();
  return name in rateLimit.plans ? name : rateLimit.defaultPlan;
}

function anonymousIdentity(defaultPlan: string): RequestIdentity {
  return {
    sub: 'anonymous',
    username: 'anonymous',
    plan: defaultPlan,
    iss: '',
  };
}

function claimValue(payload: Record<string, unknown>, claim: string): unknown {
  return payload[claim];
}

/** Primer claim no vacío de la lista. Si ninguno aplica, `sub`. */
export function resolveUsername(
  payload: Record<string, unknown>,
  claims: readonly string[],
  sub: string,
): string {
  for (const claim of claims) {
    const raw = payload[claim];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value) return value;
  }
  return sub;
}

/**
 * Identidad para la clave Redis. API Gateway ya validó la firma;
 * aquí solo se decodifica el payload (sin red / JWKS) y se filtra iss/aud.
 * El plan se resuelve contra el catálogo de la app (`rateLimit.plans`).
 */
export function identityFromRequest(
  request: FastifyRequest,
  jwt?: JwtOptions,
  rateLimit?: ResolvedRateLimit,
): RequestIdentity {
  const usernameClaim = usernameClaimsOf(jwt);
  const catalog = rateLimit ?? {
    max: 10,
    plans: undefined,
    defaultPlan: 'default',
    planClaim: 'plan',
    timeWindowMs: 60_000,
    skipOnError: false,
    banThreshold: 5,
    nameSpace: 'saludo-rl:',
  };
  const anonymous = anonymousIdentity(catalog.defaultPlan);

  const token = extractBearer(
    typeof request.headers.authorization === 'string' ? request.headers.authorization : undefined,
  );
  if (!token) return anonymous;

  try {
    const payload = decodeJwt(token);
    if (jwt?.issuer && payload.iss !== jwt.issuer) return anonymous;
    if (jwt?.audience && !audienceOf(payload.aud).includes(jwt.audience)) return anonymous;

    const sub = typeof payload.sub === 'string' && payload.sub ? payload.sub : 'anonymous';
    const username = resolveUsername(payload as Record<string, unknown>, usernameClaim, sub);
    return {
      sub,
      username,
      plan: resolvePlan(claimValue(payload, catalog.planClaim), catalog),
      iss: typeof payload.iss === 'string' ? payload.iss : '',
    };
  } catch {
    return anonymous;
  }
}
