import Redis from "ioredis";

export const redis = new Redis(process.env.REDIS_URL!, {
  family: 6,
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
});