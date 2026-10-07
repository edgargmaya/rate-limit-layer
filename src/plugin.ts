/**
 * Capa Fastify: identidad JWT → @fastify/rate-limit (Redis si hay config).
 * No registra rutas; `fastify-plugin` aplica los hooks al padre.
 * Cupos y nombres de plan: `LayerOptions.rateLimit` (la app), no este archivo.
 */

import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { compileLayer, defaults, type LayerOptions } from './config.js';
import { identityFromRequest, type RequestIdentity } from './identity.js';
import { buildRateLimitKey, clientIp } from './key.js';
import { matchLimit, type LimitMatch } from './match.js';
import { closeRedis, getRedis } from './redis.js';

declare module 'fastify' {
  interface FastifyRequest {
    rateLimitIdentity?: RequestIdentity;
    rateLimitMatch?: LimitMatch;
  }
}

const plugin: FastifyPluginAsync<LayerOptions> = async (app: FastifyInstance, opts) => {
  const headerName = opts.headerName ?? defaults.headerName;
  const headerValue = opts.headerValue ?? defaults.headerValue;
  const logMessage = opts.logMessage ?? defaults.logMessage;
  const keyParts = opts.keyParts ?? defaults.keyParts;
  const compiled = compileLayer(opts);

  const matchOf = (request: FastifyRequest): LimitMatch => {
    if (!request.rateLimitMatch) {
      request.rateLimitMatch = matchLimit(request, compiled);
    }
    return request.rateLimitMatch;
  };

  const identityOf = (request: FastifyRequest): RequestIdentity => {
    if (!request.rateLimitIdentity) {
      request.rateLimitIdentity = identityFromRequest(request, opts.jwt, matchOf(request).rateLimit);
    }
    return request.rateLimitIdentity;
  };

  const maxFor = (request: FastifyRequest): number => {
    const rl = matchOf(request).rateLimit;
    const plan = identityOf(request).plan;
    if (rl.plans) return rl.plans[plan] ?? rl.plans[rl.defaultPlan] ?? rl.max;
    return rl.max;
  };

  app.addHook('onRequest', async (request, reply) => {
    if (!matchOf(request).apply) return;
    identityOf(request);
    request.log.info({ path: request.url }, logMessage);
    void reply.header(headerName, headerValue);
  });

  const redis = opts.redis ? getRedis(opts.redis) : undefined;

  await app.register(rateLimit, {
    global: true,
    allowList: (request) => !matchOf(request).apply,
    max: (request) => maxFor(request),
    timeWindow: (request) => matchOf(request).rateLimit.timeWindowMs,
    ...(redis ? { redis } : {}),
    nameSpace: compiled.globalRateLimit.nameSpace,
    continueExceeding: true,
    skipOnError: compiled.globalRateLimit.skipOnError,
    ban: compiled.globalRateLimit.banThreshold,
    keyGenerator: (request) =>
      buildRateLimitKey(
        keyParts,
        identityOf(request),
        clientIp(request),
        matchOf(request).routeUrl,
      ),
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
    errorResponseBuilder: (_request, context) => {
      if (context.ban) {
        return {
          statusCode: 403,
          error: 'Forbidden',
          message: 'Temporarily banned due to repeated rate limit violations',
        };
      }
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Retry in ${context.after}`,
      };
    },
  });

  app.addHook('onClose', async () => {
    await closeRedis();
  });
};

export const fastifyLayer = fp(plugin, {
  name: '@edgargmaya/fastify-layer',
  fastify: '5.x',
});
