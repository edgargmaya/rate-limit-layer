export {
  defaults,
  type JwtOptions,
  type LayerOptions,
  type RateLimitKeyPart,
  type RateLimitOptions,
  type RedisConnectionOptions,
  type UserPlan,
} from './config.js';
export { identityFromRequest, type RequestIdentity } from './identity.js';
export { buildRateLimitKey } from './key.js';
export { shouldApply, requestPath } from './match.js';
export { closeRedis } from './redis.js';
export { fastifyLayer } from './plugin.js';
export { fastifyLayer as default } from './plugin.js';
