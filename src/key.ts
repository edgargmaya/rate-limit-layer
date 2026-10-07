import type { FastifyRequest } from 'fastify';
import type { RateLimitKeyPart } from './config.js';
import type { RequestIdentity } from './identity.js';

export function clientIp(request: FastifyRequest): string {
  return request.ip || '0.0.0.0';
}

/**
 * Clave estable entre instancias Lambda.
 * `alice:203.0.113.10` en `include`. Con `routes`, el patrón va al final:
 * `alice:203.0.113.10:/prefijo1/:idCliente`.
 */
export function buildRateLimitKey(
  parts: RateLimitKeyPart[],
  identity: RequestIdentity,
  ip: string,
  routeUrl?: string,
): string {
  const values: Record<RateLimitKeyPart, string> = {
    sub: identity.sub,
    username: identity.username.toLowerCase(),
    plan: identity.plan,
    iss: identity.iss,
    ip,
  };
  const base = parts.map((part) => values[part] || 'unknown').join(':');
  return routeUrl ? `${base}:${routeUrl}` : base;
}
