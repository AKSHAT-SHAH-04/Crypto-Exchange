import { Redis } from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
export const redisSub = new Redis(config.redisUrl);

export const EVENTS_CHANNEL = 'exchange:events';

export interface ExchangeEvent {
  ch: string; // e.g. "tickers", "depth:BTCUSDT", "trades:BTCUSDT", "user"
  data: unknown;
  userId?: string; // when set, delivered only to that user's sockets
}

export function publish(ev: ExchangeEvent) {
  redis.publish(EVENTS_CHANNEL, JSON.stringify(ev)).catch(() => {});
}
