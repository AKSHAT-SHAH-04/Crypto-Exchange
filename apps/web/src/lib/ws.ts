'use client';
/** Single shared WebSocket with ref-counted channel subscriptions and auto-reconnect. */
import { api } from './api';

type Listener = (data: any) => void;

class Socket {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private authed = false;
  private wantAuth = false;
  private retry = 0;

  private url() {
    return process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000/ws';
  }

  private connect() {
    if (this.ws || typeof window === 'undefined') return;
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      const chans = [...this.listeners.keys()].filter((c) => c !== 'user' && !c.endsWith(':snapshot'));
      if (chans.length) ws.send(JSON.stringify({ op: 'subscribe', channels: chans }));
      if (this.wantAuth) this.auth();
    };
    ws.onmessage = (e) => {
      try {
        const { ch, data } = JSON.parse(e.data);
        this.listeners.get(ch)?.forEach((fn) => fn(data));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      this.ws = null;
      this.authed = false;
      setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.retry++, 15000));
    };
  }

  private async auth() {
    try {
      const { token } = await api<{ token: string }>('/api/auth/ws-token');
      this.ws?.readyState === 1 && this.ws.send(JSON.stringify({ op: 'auth', token }));
      this.authed = true;
    } catch {
      /* not logged in */
    }
  }

  setAuthenticated(on: boolean) {
    this.wantAuth = on;
    this.connect();
    if (on && !this.authed && this.ws?.readyState === 1) this.auth();
  }

  /** Subscribe to a channel. Returns an unsubscribe function. */
  on(ch: string, fn: Listener) {
    this.connect();
    let set = this.listeners.get(ch);
    const isNew = !set;
    if (!set) this.listeners.set(ch, (set = new Set()));
    set.add(fn);
    const serverCh = ch.endsWith(':snapshot') ? ch.slice(0, -9) : ch;
    if (isNew && ch !== 'user' && !ch.endsWith(':snapshot') && this.ws?.readyState === 1)
      this.ws.send(JSON.stringify({ op: 'subscribe', channels: [serverCh] }));
    return () => {
      set!.delete(fn);
      if (set!.size === 0) {
        this.listeners.delete(ch);
        if (ch !== 'user' && !ch.endsWith(':snapshot') && this.ws?.readyState === 1)
          this.ws.send(JSON.stringify({ op: 'unsubscribe', channels: [ch] }));
      }
    };
  }
}

export const socket = typeof window !== 'undefined' ? ((window as any).__cxSocket ??= new Socket()) as Socket : (null as unknown as Socket);
