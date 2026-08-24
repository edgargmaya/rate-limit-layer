import type { FastifyRequest } from 'fastify';
import type { LayerOptions } from './config.js';

export function requestPath(request: FastifyRequest): string {
  const url = request.url;
  const q = url.indexOf('?');
  return q === -1 ? url : (url.slice(0, q) || '/');
}

/** true si esta request debe pasar por la capa. */
export function shouldApply(request: FastifyRequest, opts: LayerOptions): boolean {
  const path = requestPath(request);
  if (opts.exclude?.includes(path)) return false;
  if (!opts.include || opts.include.length === 0) return true;
  return opts.include.includes(path);
}
