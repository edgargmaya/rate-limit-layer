import type { FastifyRequest } from 'fastify';
import {
  compileLayer,
  type CompiledLayer,
  type LayerOptions,
  type ResolvedRateLimit,
} from './config.js';

export type LimitMatch = {
  apply: boolean;
  /**
   * Patrón Fastify que entra en la clave Redis.
   * Solo cuando la petición coincidió con `routes`. `include` no lo pone.
   */
  routeUrl?: string;
  rateLimit: ResolvedRateLimit;
};

export function requestPath(request: FastifyRequest): string {
  const url = request.url;
  const q = url.indexOf('?');
  return q === -1 ? url : (url.slice(0, q) || '/');
}

/**
 * `exclude` gana sobre todo (pathname exacto, sin query).
 * Una entrada de `routes` se compara con `request.routeOptions.url` (el patrón
 * que Fastify ya resolvió, prefijo incluido).
 * Con `routes` definido, lo que no coincida queda fuera, salvo un `include` exacto.
 * Sin `routes`, `include` conserva el comportamiento anterior.
 */
export function matchLimit(request: FastifyRequest, compiled: CompiledLayer): LimitMatch {
  const path = requestPath(request);
  const skip: LimitMatch = { apply: false, rateLimit: compiled.globalRateLimit };
  if (compiled.exclude?.includes(path)) return skip;

  const pattern = request.routeOptions?.url;
  if (pattern) {
    const rule = compiled.routeIndex.get(pattern);
    if (rule) {
      return { apply: true, routeUrl: rule.url, rateLimit: rule.rateLimit };
    }
  }

  if (compiled.hasRouteRules) {
    if (compiled.include && compiled.include.length > 0 && compiled.include.includes(path)) {
      return { apply: true, rateLimit: compiled.globalRateLimit };
    }
    return skip;
  }

  if (!compiled.include || compiled.include.length === 0) {
    return { apply: true, rateLimit: compiled.globalRateLimit };
  }
  if (compiled.include.includes(path)) {
    return { apply: true, rateLimit: compiled.globalRateLimit };
  }
  return skip;
}

/** true si esta request debe pasar por la capa. */
export function shouldApply(request: FastifyRequest, opts: LayerOptions): boolean {
  return matchLimit(request, compileLayer(opts)).apply;
}
