/**
 * TOTP (authenticator app) helpers.
 * - Secrets are stored encrypted (AES-256-GCM via ENCRYPTION_KEY); legacy plaintext secrets still verify.
 * - Each accepted time step is remembered per user, so a code can't be replayed.
 */
import { authenticator } from 'otplib';
import type { User } from '@prisma/client';
import { redis } from '../redis.js';
import { decrypt, encrypt } from './crypto.js';

authenticator.options = { window: 1 }; // tolerate ±30s clock drift

export const sealSecret = (secret: string) => `enc:${encrypt(secret)}`;
export const openSecret = (stored: string) => (stored.startsWith('enc:') ? decrypt(stored.slice(4)) : stored);

/** Verifies a 6-digit code for the user and burns its time step. */
export async function verifyTotp(user: Pick<User, 'id' | 'totpSecret'>, code: string | undefined | null): Promise<boolean> {
  if (!user.totpSecret || !code || !/^\d{6}$/.test(code)) return false;
  const delta = authenticator.checkDelta(code, openSecret(user.totpSecret));
  if (delta === null) return false;
  const step = Math.floor(Date.now() / 30_000) + delta;
  const key = `exchange:totp:last:${user.id}`;
  // atomically accept only steps newer than the last one used
  const accepted = await redis.eval(
    `local last = tonumber(redis.call('GET', KEYS[1]) or '-1')
     if tonumber(ARGV[1]) <= last then return 0 end
     redis.call('SET', KEYS[1], ARGV[1], 'EX', 300)
     return 1`,
    1,
    key,
    String(step),
  );
  return accepted === 1;
}

/** Use where 2FA is required only if enabled (withdrawals, API keys, P2P release...). */
export async function requireTotpIfEnabled(user: Pick<User, 'id' | 'totpSecret' | 'totpEnabled'>, code: string | undefined | null) {
  if (!user.totpEnabled) return true;
  return verifyTotp(user, code);
}
