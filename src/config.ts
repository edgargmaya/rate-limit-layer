/**
 * Opciones inyectadas por la app. Redis/JWT/rate-limit son opcionales:
 * sin `redis` el cupo es in-memory (una sola instancia; tests / pnpm dev).
 */

export type RedisConnectionOptions = {
  host: string;
  port?: number;
  password?: string;
  /** true en ElastiCache (transit encryption); false en Redis local típico. */
  tls?: boolean;
};

export type RateLimitKeyPart = 'sub' | 'username' | 'plan' | 'iss' | 'ip';

export type JwtOptions = {
  issuer?: string;
  audience?: string;
};

export type UserPlan = 'free' | 'premium';

export type RateLimitOptions = {
  byProfile?: Partial<Record<UserPlan, number>>;
  /** Ventana en ms (default 60_000). */
  timeWindowMs?: number;
  /** true = fail-open si Redis falla. */
  skipOnError?: boolean;
  banThreshold?: number;
  nameSpace?: string;
};

export type LayerOptions = {
  include?: string[];
  exclude?: string[];
  headerName?: string;
  headerValue?: string;
  logMessage?: string;
  redis?: RedisConnectionOptions;
  jwt?: JwtOptions;
  keyParts?: RateLimitKeyPart[];
  rateLimit?: RateLimitOptions;
};

export const defaults = {
  headerName: 'x-serverless-layer',
  headerValue: '1',
  logMessage: 'serverless-layer: request intercepted',
  keyParts: ['username', 'plan', 'ip'] as RateLimitKeyPart[],
  rateLimit: {
    byProfile: { free: 10, premium: 25 } satisfies Record<UserPlan, number>,
    timeWindowMs: 60_000,
    skipOnError: false,
    banThreshold: 5,
    nameSpace: 'saludo-rl:',
  },
};
