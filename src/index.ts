export {
  TIME_WINDOWS,
  compileLayer,
  DEFAULT_USERNAME_CLAIMS,
  defaults,
  usernameClaimsOf,
  resolveRateLimit,
  resolveRouteRateLimit,
  resolveTimeWindowMs,
  type CompiledLayer,
  type JwtOptions,
  type LayerOptions,
  type RateLimitKeyPart,
  type RateLimitOptions,
  type RedisConnectionOptions,
  type ResolvedRateLimit,
  type RouteRateLimitOptions,
  type RouteRule,
  type TimeWindow,
  type TimeWindowUnit,
  type UserPlan,
} from './config.js';
export { identityFromRequest, resolvePlan, resolveUsername, type RequestIdentity } from './identity.js';
export { buildRateLimitKey } from './key.js';
export { matchLimit, requestPath, shouldApply, type LimitMatch } from './match.js';
export { closeRedis } from './redis.js';
export { fastifyLayer } from './plugin.js';
export { fastifyLayer as default } from './plugin.js';
