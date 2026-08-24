import Link from "next/link";

export function Forbidden() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-6xl font-bold text-brand-600">403</p>
      <h1 className="mt-4 text-xl font-semibold text-slate-800">无权访问</h1>
      <p className="mt-2 text-sm text-slate-500">您没有访问该页面的权限，如有需要请联系系统管理员。</p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        返回仪表盘
      </Link>
    </div>
  );
}
