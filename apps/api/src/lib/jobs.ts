import { randomToken } from './crypto.js';
import { redis } from '../redis.js';

/**
 * Runs fn on an interval, but only in one process at a time (Redis lock), and never overlapping itself.
 * Safe to start in every API instance.
 */
export function scheduleJob(name: string, everyMs: number, fn: () => Promise<void>) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    const token = randomToken(8);
    const key = `exchange:job:${name}`;
    try {
      const got = await redis.set(key, token, 'PX', Math.max(everyMs * 3, 60_000), 'NX');
      if (got !== 'OK') return;
      await fn();
    } catch (e) {
      console.error(`[job:${name}] failed`, e);
    } finally {
      // release only our own lock
      await redis
        .eval(`if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`, 1, key, token)
        .catch(() => {});
      running = false;
    }
  };
  setTimeout(tick, 5_000);
  setInterval(tick, everyMs);
}
