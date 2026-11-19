'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { socket } from './ws';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  googleEnabled: boolean;
  tradingMode: 'paper' | 'live';
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleEnabled, setGoogle] = useState(false);
  const [tradingMode, setMode] = useState<'paper' | 'live'>('paper');

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: User | null; googleEnabled: boolean; tradingMode: 'paper' | 'live' }>('/api/auth/me');
      setUser(r.user);
      setGoogle(r.googleEnabled);
      setMode(r.tradingMode);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    socket?.setAuthenticated(!!user);
  }, [user]);

  return <Ctx.Provider value={{ user, loading, googleEnabled, tradingMode, refresh, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
