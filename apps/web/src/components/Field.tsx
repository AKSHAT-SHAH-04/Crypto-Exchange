export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const good = ['FILLED', 'COMPLETED', 'APPROVED'].includes(status);
  const bad = ['REJECTED', 'CANCELED'].includes(status);
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${good ? 'bg-up/15 text-up' : bad ? 'bg-down/15 text-down' : 'bg-brand/15 text-brand'}`}>
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}
