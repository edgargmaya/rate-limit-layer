import type { FastifyRequest } from 'fastify';
import type { RateLimitKeyPart } from './config.js';
import type { RequestIdentity } from './identity.js';

export function clientIp(request: FastifyRequest): string {
  return request.ip || '0.0.0.0';
}

/** Clave estable entre instancias Lambda: p. ej. `alice:premium:203.0.113.10`. */
export function buildRateLimitKey(
  parts: RateLimitKeyPart[],
  identity: RequestIdentity,
  ip: string,
): string {
  const values: Record<RateLimitKeyPart, string> = {
    sub: identity.sub,
    username: identity.username.toLowerCase(),
    plan: identity.plan,
    iss: identity.iss,
    ip,
  };
  return parts.map((part) => values[part] || 'unknown').join(':');
}
