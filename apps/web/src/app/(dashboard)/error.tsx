"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-lg border border-border bg-surface p-8 text-center">
      <h1 className="text-lg font-semibold text-ink-primary">页面加载失败</h1>
      <p className="mt-2 text-sm text-ink-secondary">{error.message || "发生未知错误，请稍后重试。"}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        重试
      </button>
    </div>
  );
}
