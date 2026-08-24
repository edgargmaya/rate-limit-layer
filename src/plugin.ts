/**
 * Capa Fastify: identidad JWT → @fastify/rate-limit (Redis si hay config).
 * No registra rutas; `fastify-plugin` aplica los hooks al padre.
 */

import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { defaults, type LayerOptions, type UserPlan } from './config.js';
import { identityFromRequest, type RequestIdentity } from './identity.js';
import { buildRateLimitKey, clientIp } from './key.js';
import { shouldApply } from './match.js';
import { closeRedis, getRedis } from './redis.js';

declare module 'fastify' {
  interface FastifyRequest {
    rateLimitIdentity?: RequestIdentity;
  }
}

function identityOf(request: FastifyRequest, opts: LayerOptions): RequestIdentity {
  if (!request.rateLimitIdentity) {
    request.rateLimitIdentity = identityFromRequest(request, opts.jwt);
  }
  return request.rateLimitIdentity;
}

const plugin: FastifyPluginAsync<LayerOptions> = async (app: FastifyInstance, opts) => {
  const headerName = opts.headerName ?? defaults.headerName;
  const headerValue = opts.headerValue ?? defaults.headerValue;
  const logMessage = opts.logMessage ?? defaults.logMessage;
  const keyParts = opts.keyParts ?? defaults.keyParts;
  const rl = { ...defaults.rateLimit, ...opts.rateLimit };
  const byProfile = { ...defaults.rateLimit.byProfile, ...rl.byProfile };

  app.addHook('onRequest', async (request, reply) => {
    if (!shouldApply(request, opts)) return;
    identityOf(request, opts);
    request.log.info({ path: request.url }, logMessage);
    void reply.header(headerName, headerValue);
  });

  const redis = opts.redis ? getRedis(opts.redis) : undefined;

  await app.register(rateLimit, {
    global: true,
    allowList: (request) => !shouldApply(request, opts),
    max: (request) => {
      const plan: UserPlan = identityOf(request, opts).plan;
      return byProfile[plan] ?? byProfile.free;
    },
    timeWindow: rl.timeWindowMs,
    ...(redis ? { redis } : {}),
    nameSpace: rl.nameSpace,
    continueExceeding: true,
    skipOnError: rl.skipOnError,
    ban: rl.banThreshold,
    keyGenerator: (request) =>
      buildRateLimitKey(keyParts, identityOf(request, opts), clientIp(request)),
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
