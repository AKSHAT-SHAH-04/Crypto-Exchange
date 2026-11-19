import { prisma } from '../db.js';
import { publish } from '../redis.js';

export interface NotificationInput {
  type: string; // order | alert | wallet | kyc | p2p | support | system
  title: string;
  body: string;
  link?: string;
}

/** Persists an in-app notification and pushes it to the user's open sockets. Never throws. */
export async function notify(userId: string, n: NotificationInput) {
  try {
    const rec = await prisma.notification.create({ data: { userId, ...n } });
    publish({ ch: 'user', userId, data: { type: 'notification', notification: rec } });
  } catch (e) {
    console.error('[notify] failed', e);
  }
}
