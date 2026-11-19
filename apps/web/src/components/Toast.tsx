'use client';
import { createContext, useCallback, useContext, useState } from 'react';
import clsx from 'clsx';

type Kind = 'success' | 'error' | 'info';
interface T { id: number; kind: Kind; text: string }
const Ctx = createContext<(text: string, kind?: Kind) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((text: string, kind: Kind = 'info') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={clsx(
              'pointer-events-auto rounded-md border bg-panel px-4 py-3 text-sm shadow-lg',
              t.kind === 'success' && 'border-up/50',
              t.kind === 'error' && 'border-down/50',
              t.kind === 'info' && 'border-line',
            )}
          >
            <span className={clsx('mr-2 font-semibold', t.kind === 'success' && 'text-up', t.kind === 'error' && 'text-down')}>
              {t.kind === 'success' ? '✓' : t.kind === 'error' ? '!' : 'i'}
            </span>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
