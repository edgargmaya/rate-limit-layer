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

/**
 * Orden para armar el username de la clave Redis.
 * El primero que sea un string no vacío gana. Si ninguno viene, se usa `sub`.
 */
export const DEFAULT_USERNAME_CLAIMS = ['preferred_username', 'email', 'nickname'] as const;

export type JwtOptions = {
  issuer?: string;
  audience?: string;
  /**
   * Claims, en orden de prioridad, de los que sale `identity.username`.
   * Default: `preferred_username`, `email`, `nickname`. Después, `sub`.
   */
  usernameClaim?: string[];
};

/** Lista efectiva. Un nombre vacío falla al registrar, no en cada request. */
export function usernameClaimsOf(jwt?: JwtOptions): string[] {
  if (jwt?.usernameClaim === undefined) return [...DEFAULT_USERNAME_CLAIMS];
  return jwt.usernameClaim.map((name, index) => {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error(`fastify-layer: jwt.usernameClaim[${index}] must be a non-empty string`);
    }
    return name.trim();
  });
}

/** Nombre de plan: lo define la app (`starter`, `free`, …). */
export type UserPlan = string;

/** Unidad de la ventana. Una sola por regla: no se combinan minuto y hora. */
export type TimeWindowUnit = 'minute' | 'hour' | 'day';

/**
 * Duración de esa única ventana.
 * `'minute'` son 1 minuto. `{ unit: 'minute', every: 5 }` son 5 minutos.
 */
export type TimeWindow = TimeWindowUnit | { unit: TimeWindowUnit; every?: number };

export const TIME_WINDOWS: Record<TimeWindowUnit, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

export type RateLimitOptions = {
  /** Cupo único cuando no hay `plans`. */
  max?: number;
  /** nombre de plan → máximo de requests en la ventana. Si está presente, manda sobre `max`. */
  plans?: Record<string, number>;
  /** Obligatorio si hay `plans`: fallback sin JWT, claim vacío o plan desconocido. */
  defaultPlan?: string;
  /** Claim del JWT (default `plan`). */
  planClaim?: string;
  /**
   * Ventana única. `'hour'` = 1 hora. `{ unit: 'hour', every: 8 }` = 8 horas.
   * Si se indica, manda sobre `timeWindowMs`.
   */
  window?: TimeWindow;
  /** Ventana en ms. Default 60_000 (un minuto) cuando no hay `window`. */
  timeWindowMs?: number;
  /** true = fail-open si Redis falla. Global: una regla de ruta no lo cambia. */
  skipOnError?: boolean;
  /** Global: una regla de ruta no lo cambia. */
  banThreshold?: number;
  /** Global: una regla de ruta no lo cambia. */
  nameSpace?: string;
};

/**
 * Cupo de una ruta. Hereda del `rateLimit` global lo que no indique.
 * Ban, namespace y skipOnError siguen siendo los globales.
 */
export type RouteRateLimitOptions = {
  max?: number;
  plans?: Record<string, number>;
  defaultPlan?: string;
  planClaim?: string;
  window?: TimeWindow;
  timeWindowMs?: number;
};

/**
 * Patrón de Fastify (`request.routeOptions.url`), prefijo incluido.
 * `/prefijo1/:idCliente` cubre `/prefijo1/acme` y `/prefijo1/bob` con el mismo cupo.
 */
export type RouteRule = {
  url: string;
  rateLimit?: RouteRateLimitOptions;
};

export type LayerOptions = {
  include?: string[];
  exclude?: string[];
  /**
   * Reglas por patrón de ruta. Cada una puede traer su cupo y su ventana.
   * Si se define `routes`, una ruta que no coincida aquí ni en `include` queda fuera.
   */
  routes?: RouteRule[];
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

function isTimeWindowUnit(value: string): value is TimeWindowUnit {
  return Object.prototype.hasOwnProperty.call(TIME_WINDOWS, value);
}

function durationOf(window: TimeWindow): number {
  if (typeof window === 'string') {
    if (!isTimeWindowUnit(window)) {
      throw new Error('fastify-layer: window must be minute, hour, or day');
    }
    return TIME_WINDOWS[window];
  }
  if (window === null || typeof window !== 'object' || !isTimeWindowUnit(window.unit)) {
    throw new Error('fastify-layer: window must be minute, hour, or day, or { unit, every }');
  }
  const every = window.every ?? 1;
  assertPositiveInt(every, 'window.every');
  const ms = TIME_WINDOWS[window.unit] * every;
  if (!Number.isSafeInteger(ms)) {
    throw new Error('fastify-layer: window is too long');
  }
  return ms;
}

export function resolveTimeWindowMs(opts?: { window?: TimeWindow; timeWindowMs?: number }): number {
  if (opts?.window !== undefined && opts.timeWindowMs !== undefined) {
    throw new Error('fastify-layer: set window or timeWindowMs, not both');
  }
  if (opts?.window !== undefined) return durationOf(opts.window);
  const timeWindowMs = opts?.timeWindowMs ?? defaults.rateLimit.timeWindowMs;
  assertPositiveInt(timeWindowMs, 'timeWindowMs');
  return timeWindowMs;
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
  const timeWindowMs = resolveTimeWindowMs(opts);
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

/**
 * Cupo efectivo de una regla. Sin `rateLimit` en la regla, es el global.
 * `max` en la regla pasa a cupo único. `plans` en la regla sustituye el catálogo.
 * La ventana de la regla, si viene, sustituye la global. Ban y namespace no.
 */
export function resolveRouteRateLimit(
  route: RouteRateLimitOptions | undefined,
  global: ResolvedRateLimit,
): ResolvedRateLimit {
  if (route === undefined) return global;

  const opts: RateLimitOptions = {
    planClaim: route.planClaim?.trim() || global.planClaim,
    skipOnError: global.skipOnError,
    banThreshold: global.banThreshold,
    nameSpace: global.nameSpace,
  };

  if (route.window !== undefined) opts.window = route.window;
  else if (route.timeWindowMs !== undefined) opts.timeWindowMs = route.timeWindowMs;
  else opts.timeWindowMs = global.timeWindowMs;

  const planKeys = route.plans ? Object.keys(route.plans) : [];
  if (route.plans && planKeys.length > 0) {
    opts.plans = route.plans;
    const inherited = route.defaultPlan ?? (global.plans ? global.defaultPlan : undefined);
    if (inherited !== undefined) opts.defaultPlan = inherited;
  } else if (route.max !== undefined) {
    opts.max = route.max;
  } else if (global.plans) {
    opts.plans = global.plans;
    opts.defaultPlan = route.defaultPlan ?? global.defaultPlan;
  } else {
    opts.max = global.max;
  }

  return resolveRateLimit(opts);
}

export type CompiledRoute = {
  url: string;
  rateLimit: ResolvedRateLimit;
};

export type CompiledLayer = {
  include?: string[];
  exclude?: string[];
  routeIndex: Map<string, CompiledRoute>;
  /** true cuando la app pasó `routes`, aunque el array venga vacío. */
  hasRouteRules: boolean;
  globalRateLimit: ResolvedRateLimit;
};

function normalizeRouteUrl(url: string, index: number): string {
  const trimmed = url.trim();
  if (!trimmed.startsWith('/')) {
    throw new Error(`fastify-layer: routes[${index}].url must start with /`);
  }
  if (trimmed.includes('?')) {
    throw new Error(`fastify-layer: routes[${index}].url must be a path pattern, without query`);
  }
  return trimmed;
}

/** Valida reglas al registrar. El match en runtime solo consulta este índice. */
export function compileLayer(opts: LayerOptions): CompiledLayer {
  const globalRateLimit = resolveRateLimit(opts.rateLimit);
  const routeIndex = new Map<string, CompiledRoute>();
  const list = opts.routes ?? [];

  list.forEach((rule, index) => {
    const url = normalizeRouteUrl(rule.url, index);
    if (routeIndex.has(url)) {
      throw new Error(`fastify-layer: duplicate routes url "${url}"`);
    }
    routeIndex.set(url, {
      url,
      rateLimit: resolveRouteRateLimit(rule.rateLimit, globalRateLimit),
    });
  });

  return {
    ...(opts.include ? { include: opts.include } : {}),
    ...(opts.exclude ? { exclude: opts.exclude } : {}),
    routeIndex,
    hasRouteRules: opts.routes !== undefined,
    globalRateLimit,
  };
}
