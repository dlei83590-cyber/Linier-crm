export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <h1 className="text-lg font-semibold text-ink-primary">{title}</h1>
      <p className="mt-2 text-sm text-ink-secondary">{description}</p>
      <div className="mt-6 rounded-md bg-canvas p-4 text-sm text-ink-muted">
        尚未开放
      </div>
    </div>
  );
}
