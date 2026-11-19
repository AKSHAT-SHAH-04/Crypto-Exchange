export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-120px)] max-w-md items-center px-4 py-10">
      <div className="card w-full p-6 sm:p-8">
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-md border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>;
}
