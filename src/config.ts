/**
 * Opciones inyectadas por la app. Redis/JWT/rate-limit son opcionales:
 * sin `redis` el cupo es in-memory (una sola instancia; tests / pnpm dev).
 * Los nombres y cupos de plan los define la app (`plans` / `max`), no este paquete.
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

/** Nombre de plan: lo define la app (`starter`, `free`, …). */
export type UserPlan = string;

export type RateLimitOptions = {
  /** Cupo único cuando no hay `plans`. */
  max?: number;
  /** nombre de plan → máximo de requests en la ventana. Si está presente, manda sobre `max`. */
  plans?: Record<string, number>;
  /** Obligatorio si hay `plans`: fallback sin JWT, claim vacío o plan desconocido. */
  defaultPlan?: string;
  /** Claim del JWT (default `plan`). */
  planClaim?: string;
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

export type ResolvedRateLimit = {
  max: number;
  plans: Record<string, number> | undefined;
  defaultPlan: string;
  planClaim: string;
  timeWindowMs: number;
  skipOnError: boolean;
  banThreshold: number;
  nameSpace: string;
};

export const defaults = {
  headerName: 'x-serverless-layer',
  headerValue: '1',
  logMessage: 'serverless-layer: request intercepted',
  keyParts: ['username', 'ip'] as RateLimitKeyPart[],
  rateLimit: {
    max: 10,
    planClaim: 'plan',
    timeWindowMs: 60_000,
    skipOnError: false,
    banThreshold: 5,
    nameSpace: 'saludo-rl:',
    defaultPlan: 'default',
  },
};

function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`fastify-layer: ${label} must be a positive integer`);
  }
}

function normalizePlanName(raw: string, label: string): string {
  const name = raw.trim().toLowerCase();
  if (!name) {
    throw new Error(`fastify-layer: ${label} must be a non-empty string`);
  }
  return name;
}

/**
 * Normaliza `rateLimit` de la app. Fail-fast en `register()`, no en cada request.
 */
export function resolveRateLimit(opts?: RateLimitOptions): ResolvedRateLimit {
  const timeWindowMs = opts?.timeWindowMs ?? defaults.rateLimit.timeWindowMs;
  const skipOnError = opts?.skipOnError ?? defaults.rateLimit.skipOnError;
  const banThreshold = opts?.banThreshold ?? defaults.rateLimit.banThreshold;
  const nameSpace = opts?.nameSpace ?? defaults.rateLimit.nameSpace;
  const planClaim = opts?.planClaim?.trim() || defaults.rateLimit.planClaim;
  assertPositiveInt(timeWindowMs, 'timeWindowMs');
  assertPositiveInt(banThreshold, 'banThreshold');

  const rawPlans = opts?.plans;
  const planKeys = rawPlans ? Object.keys(rawPlans) : [];
  if (rawPlans && planKeys.length > 0) {
    const plans: Record<string, number> = {};
    for (const key of planKeys) {
      const name = normalizePlanName(key, 'plan name');
      const max = rawPlans[key];
      if (max === undefined) continue;
      assertPositiveInt(max, `plans.${key}`);
      plans[name] = max;
    }
    if (opts?.defaultPlan === undefined || opts.defaultPlan.trim() === '') {
      throw new Error('fastify-layer: defaultPlan is required when plans is set');
    }
    const defaultPlan = normalizePlanName(opts.defaultPlan, 'defaultPlan');
    const defaultMax = plans[defaultPlan];
    if (defaultMax === undefined) {
      throw new Error(`fastify-layer: defaultPlan "${defaultPlan}" must exist in plans`);
    }
    return {
      max: defaultMax,
      plans,
      defaultPlan,
      planClaim,
      timeWindowMs,
      skipOnError,
      banThreshold,
      nameSpace,
    };
  }

  const max = opts?.max ?? defaults.rateLimit.max;
  assertPositiveInt(max, 'max');
  return {
    max,
    plans: undefined,
    defaultPlan: defaults.rateLimit.defaultPlan,
    planClaim,
    timeWindowMs,
    skipOnError,
    banThreshold,
    nameSpace,
  };
}
