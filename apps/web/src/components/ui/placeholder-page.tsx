export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="text-lg font-semibold text-slate-800">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
      <div className="mt-6 rounded-md bg-slate-50 p-4 text-sm text-slate-400">
        该模块将在后续 Sprint 中开发，敬请期待。
      </div>
    </div>
  );
}
