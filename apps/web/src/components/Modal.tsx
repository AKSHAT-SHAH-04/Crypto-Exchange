'use client';
import { useEffect } from 'react';

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-line/60 bg-panel p-6 shadow-2xl sm:rounded-3xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-2xl leading-none text-muted hover:text-fg" aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
