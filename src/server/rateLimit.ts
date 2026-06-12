/**
 * Per-IP rate limiter for vote submissions: Upstash Redis when configured
 * (durable across serverless instances), with an in-memory fixed-window
 * fallback for local dev. Battle tokens already make each vote single-use;
 * this caps the rate at which an actor can pull battles and vote.
 *
 * Optional integration: without `UPSTASH_REDIS_REST_URL` +
 * `UPSTASH_REDIS_REST_TOKEN` the limiter quietly uses process memory.
 */
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
});

const isRedisConfigured = (): boolean =>
  !!(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );

const WINDOW_MS = 60_000;
const WINDOW_SECONDS = WINDOW_MS / 1000;
const MAX_VOTES_PER_WINDOW = 40;

type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export const checkVoteRateLimit = async (ip: string): Promise<RateLimitResult> =>
  isRedisConfigured() ? checkRedis(ip) : checkMemory(ip);

/* -------------------------------- Redis ---------------------------------- */

const checkRedis = async (ip: string): Promise<RateLimitResult> => {
  const key = `humanness:ratelimit:vote:${ip}`;
  const count = (await redis.get<number>(key)) ?? 0;
  if (count >= MAX_VOTES_PER_WINDOW) {
    const ttl = await redis.ttl(key);
    return {
      allowed: false,
      retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS,
    };
  }
  await redis.incr(key);
  if (count === 0) await redis.expire(key, WINDOW_SECONDS);
  return { allowed: true, retryAfterSeconds: 0 };
};

/* ------------------------------ In-memory -------------------------------- */

type WindowRecord = { count: number; resetAt: number };
const buckets = new Map<string, WindowRecord>();

const checkMemory = (ip: string): RateLimitResult => {
  const now = Date.now();
  if (buckets.size > 10_000) {
    for (const [key, record] of buckets) {
      if (record.resetAt < now) buckets.delete(key);
    }
  }
  const record = buckets.get(ip);
  if (!record || record.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (record.count >= MAX_VOTES_PER_WINDOW) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((record.resetAt - now) / 1000)),
    };
  }
  record.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
};

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export const clientIpFrom = (request: Request): string => {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
};
