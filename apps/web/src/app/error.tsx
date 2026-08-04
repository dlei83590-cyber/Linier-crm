"use client";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <h1 className="text-xl font-semibold text-slate-800">页面出错了</h1>
      <p className="mt-2 text-sm text-slate-500">{error.message || "发生未知错误，请稍后重试。"}</p>
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
