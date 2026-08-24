import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 text-center">
      <p className="text-6xl font-bold text-ink-muted">404</p>
      <h1 className="mt-4 text-xl font-semibold text-ink-primary">页面不存在</h1>
      <p className="mt-2 text-sm text-ink-secondary">您访问的页面不存在或已被移除。</p>
      <Link
        href="/dashboard"
        className="mt-6 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        返回仪表盘
      </Link>
    </div>
  );
}
