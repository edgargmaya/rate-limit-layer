import { Redis } from 'ioredis';
import type { RedisConnectionOptions } from './config.js';

let client: Redis | undefined;
let clientKey: string | undefined;

function cacheKey(config: RedisConnectionOptions): string {
  return `${config.host}:${config.port ?? 6379}:${config.tls ? 'tls' : 'plain'}`;
}

/**
 * Un cliente por proceso (warm Lambda). lazyConnect: no abre socket en el import.
 */
export function getRedis(config: RedisConnectionOptions): Redis {
  const key = cacheKey(config);
  if (client && clientKey === key) return client;

  void closeRedis();

  client = new Redis({
    host: config.host,
    port: config.port ?? 6379,
    ...(config.password ? { password: config.password } : {}),
    ...(config.tls ? { tls: {} } : {}),
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
    keepAlive: 10_000,
    connectTimeout: 3_000,
    retryStrategy: (times: number) => Math.min(times * 50, 1_000),
  });
  clientKey = key;
  client.on('error', (err: Error) => {
    console.error('[redis]', err.message);
  });
  return client;
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  const current = client;
  client = undefined;
  clientKey = undefined;
  await current.quit().catch(() => current.disconnect());
}
