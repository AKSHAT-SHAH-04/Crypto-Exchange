/**
 * Fireblocks custody (omnibus model): one omnibus vault account holds all customer funds; every user gets
 * their own deposit address per asset inside it (customerRefId = our user id). Incoming deposits and
 * withdrawal status changes arrive via signed webhooks (see routes/webhooks.ts).
 *
 * API auth: every request carries X-API-Key plus a short-lived RS256 JWT signed with the API user's
 * private key, containing the request URI and a SHA-256 hash of the body.
 * Docs: https://developers.fireblocks.com/reference/signing-a-request-jwt-structure
 *
 * Verify the asset ids in FIREBLOCKS_ASSET_MAP against your workspace (sandbox ids can differ from mainnet).
 */
import { createVerify, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { sha256 } from '../lib/crypto.js';
import type { CustodyProvider } from './types.js';

const fb = config.fireblocks;
const pem = (v: string) => (v.includes('BEGIN') ? v.replace(/\\n/g, '\n') : Buffer.from(v, 'base64').toString('utf8'));

export function fireblocksAssetId(asset: string, network: string) {
  const id = fb.assetMap[`${asset}:${network}`];
  if (!id) throw new Error(`No Fireblocks asset id configured for ${asset} on ${network} (FIREBLOCKS_ASSET_MAP)`);
  return id;
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const bodyStr = body === undefined ? '' : JSON.stringify(body);
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    { uri: path, nonce: randomUUID(), iat: now, exp: now + 55, sub: fb.apiKey, bodyHash: sha256(bodyStr) },
    pem(fb.secretKey),
    { algorithm: 'RS256', noTimestamp: true },
  );
  const res = await fetch(`${fb.baseUrl}${path}`, {
    method,
    headers: {
      'X-API-Key': fb.apiKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: bodyStr || undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Fireblocks ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Verifies the `fireblocks-signature` header (base64 RSA-SHA512 over the raw body). */
export function verifyFireblocksWebhook(rawBody: string, signature: string | undefined) {
  if (!signature) return false;
  try {
    return createVerify('RSA-SHA512').update(rawBody).verify(pem(fb.webhookPublicKey), signature, 'base64');
  } catch {
    return false;
  }
}

export const fireblocksCustody: CustodyProvider = {
  name: 'fireblocks',
  synchronous: false,
  async createDepositAddress(userId, asset, network) {
    const assetId = fireblocksAssetId(asset, network);
    const r = await request<{ address: string; tag?: string; legacyAddress?: string }>(
      'POST',
      `/v1/vault/accounts/${fb.vaultAccountId}/${assetId}/addresses`,
      { description: `user ${userId}`, customerRefId: userId },
      `addr-${userId}-${asset}-${network}`,
    );
    return { address: r.address, tag: r.tag || null, providerRef: assetId };
  },
  async sendWithdrawal(w) {
    const assetId = fireblocksAssetId(w.asset, w.network);
    const r = await request<{ id: string; status: string }>(
      'POST',
      '/v1/transactions',
      {
        assetId,
        amount: w.amount,
        source: { type: 'VAULT_ACCOUNT', id: fb.vaultAccountId },
        destination: { type: 'ONE_TIME_ADDRESS', oneTimeAddress: { address: w.address, ...(w.tag ? { tag: w.tag } : {}) } },
        externalTxId: w.id, // Fireblocks rejects duplicates → safe to retry
        note: `withdrawal ${w.id}`,
      },
      `wd-${w.id}`,
    );
    return { providerRef: r.id };
  },
};
