"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { hasPermission, PERMISSIONS, type PermissionCode, type RoleCode, APP_NAME, APP_VERSION } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";

const NAV_ITEMS: ReadonlyArray<{ href: string; label: string; permission: PermissionCode | null }> = [
  { href: "/dashboard", label: "Dashboard", permission: null },
  { href: "/users", label: "用户管理", permission: PERMISSIONS.USER_READ },
  { href: "/departments", label: "部门管理", permission: PERMISSIONS.USER_READ },
  { href: "/roles", label: "角色权限", permission: PERMISSIONS.ROLE_READ },
  { href: "/audit-logs", label: "操作日志", permission: PERMISSIONS.AUDIT_READ },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { state, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/login");
    }
  }, [state.status, router]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (state.status !== "authenticated" || !state.user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">加载中…</p>
      </div>
    );
  }

  const user = state.user;

  const visibleItems = NAV_ITEMS.filter(
    (item) => item.permission === null || hasPermission(user.roles as RoleCode[], item.permission)
  );
  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-4">
      {visibleItems.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100 md:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="切换菜单"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-brand-600 text-sm font-semibold text-white">
              利
            </span>
            <span className="text-sm font-semibold text-slate-800">利尼尔 CRM 管理系统</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/profile" className="hidden text-sm text-slate-500 hover:text-slate-800 sm:block">
            {user.email}
          </Link>
          <button
            type="button"
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            退出
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl">
        {/* Desktop sidebar */}
        <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white md:block">{sidebar}</aside>

        {/* Mobile sidebar */}
        {menuOpen && (
          <div className="fixed inset-0 z-30 md:hidden">
            <button
              type="button"
              aria-label="关闭菜单"
              className="absolute inset-0 bg-slate-900/30"
              onClick={() => setMenuOpen(false)}
            />
            <aside className="absolute inset-y-0 left-0 w-56 bg-white shadow-lg">{sidebar}</aside>
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-400">
        <p>{APP_NAME} · {APP_VERSION}</p>
        <p className="mt-0.5">
          Build: {process.env.NEXT_PUBLIC_BUILD_ID ?? "-"} · Git Commit: {process.env.NEXT_PUBLIC_GIT_SHA ?? "-"} ·
          Deployment: {process.env.NEXT_PUBLIC_DEPLOYMENT_URL ?? "-"}
        </p>
      </footer>
    </div>
  );
}
