import Redis from "ioredis";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_URL ?? process.env.REDIS_URL!;
    redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
      tls: url.startsWith("rediss://") ? {} : undefined,
    });
  }
  return redis;
}

export async function writeSnapshot(
  raceId: string,
  kind: string,
  data: unknown,
  ttlSeconds = 30,
): Promise<void> {
  try {
    const key = `r:${raceId}:${kind}`;
    await getRedis().set(key, JSON.stringify(data), "EX", ttlSeconds);
  } catch (err: any) {
    console.error(`[Redis] Failed to write r:${raceId}:${kind}:`, err.message);
  }
}
