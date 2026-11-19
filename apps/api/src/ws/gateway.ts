/**
 * WebSocket gateway at /ws. Fans out events from Redis pub/sub so multiple API instances can share it.
 *
 * Client -> server:
 *   {"op":"subscribe","channels":["tickers","depth:BTCUSDT","trades:BTCUSDT"]}
 *   {"op":"unsubscribe","channels":[...]}
 *   {"op":"auth","token":"<from GET /api/auth/ws-token>"}   // enables the private "user" channel
 * Server -> client: {"ch":"...","data":...}
 */
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { redis, redisSub, EVENTS_CHANNEL, type ExchangeEvent } from '../redis.js';
import { verifyJwt } from '../lib/auth.js';
import { getTickers, getMarketTrades } from '../market/feed.js';
import { getBook } from '../engine/engine.js';

interface Client {
  ws: WebSocket;
  channels: Set<string>;
  userId?: string;
}

const clients = new Set<Client>();

export async function registerGateway(app: FastifyInstance) {
  await redisSub.subscribe(EVENTS_CHANNEL);
  redisSub.on('message', (_c, raw) => {
    let ev: ExchangeEvent;
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    const msg = JSON.stringify({ ch: ev.ch, data: ev.data });
    for (const c of clients) {
      if (c.ws.readyState !== 1) continue;
      if (ev.userId) {
        if (c.userId === ev.userId) c.ws.send(msg);
      } else if (c.channels.has(ev.ch)) c.ws.send(msg);
    }
  });

  app.get('/ws', { websocket: true }, (socket) => {
    const client: Client = { ws: socket, channels: new Set() };
    clients.add(client);
    socket.on('message', async (raw: Buffer) => {
      let m: any;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.op === 'ping') return socket.send(JSON.stringify({ ch: 'pong', data: Date.now() }));
      if (m.op === 'auth' && typeof m.token === 'string') {
        const p = verifyJwt(m.token, 'ws');
        client.userId = p?.sub;
        return socket.send(JSON.stringify({ ch: 'auth', data: { ok: !!p } }));
      }
      if (!Array.isArray(m.channels)) return;
      const chans = m.channels.filter((c: unknown) => typeof c === 'string').slice(0, 50) as string[];
      if (m.op === 'subscribe') {
        for (const ch of chans) {
          client.channels.add(ch);
          // send a snapshot immediately so the UI doesn't wait for the next tick
          if (ch === 'tickers') socket.send(JSON.stringify({ ch, data: getTickers() }));
          else if (ch.startsWith('depth:')) {
            const book = getBook(ch.slice(6));
            if (book) socket.send(JSON.stringify({ ch, data: book.depth(20) }));
            else {
              const cached = await redis.get(`exchange:${ch}`);
              if (cached) socket.send(JSON.stringify({ ch, data: JSON.parse(cached) }));
            }
          } else if (ch.startsWith('trades:')) {
            socket.send(JSON.stringify({ ch: `${ch}:snapshot`, data: getMarketTrades(ch.slice(7)) }));
          }
        }
      } else if (m.op === 'unsubscribe') chans.forEach((c) => client.channels.delete(c));
    });
    socket.on('close', () => clients.delete(client));
    socket.on('error', () => clients.delete(client));
  });

  // keep idle connections alive through proxies
  setInterval(() => {
    for (const c of clients) if (c.ws.readyState === 1) c.ws.ping();
  }, 25_000);
}
