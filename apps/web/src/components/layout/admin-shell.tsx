"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { hasPermission, APP_NAME, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { MODULE_DOMAINS, MODULES, type FrontendModule, type ModuleDomain } from "@/lib/frontend/modules";

/**
 * Admin Shell — Frontend Productization Reset F2-0（IA v2）
 *
 * 导航唯一事实来源 = Module Registry（apps/web/src/lib/frontend/modules.ts）。
 * 废除旧的一维 NAV_ITEMS 数组；Sidebar / 移动菜单均消费同一份 Registry。
 *
 * 规则：
 * - 一级域分组（9 域，顺序见 MODULE_DOMAINS），可折叠；当前业务域自动展开
 * - 无权限 item 不出现（permission 为 null 或 hasPermission 通过）
 * - availability=hold 的 item 明确视觉区分（“尚未开放”），不可点击（禁止假功能）
 * - 真实可用页面（ready）显示正常业务名称
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const { state, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<ModuleDomain>>(new Set());

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/login");
    }
  }, [state.status, router]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const user = state.user;
  const roles = (user?.roles ?? []) as RoleCode[];

  // 权限过滤后的可见模块
  const visibleModules = useMemo(
    () =>
      MODULES.filter(
        (m) => m.permission === null || hasPermission(roles, m.permission),
      ),
    [roles],
  );

  // 当前业务域（根据 pathname 匹配 route 前缀；未命中时默认展开第一个非空域）
  const currentDomain = useMemo<ModuleDomain | null>(() => {
    const matched = visibleModules.find(
      (m) => pathname === m.route || pathname.startsWith(`${m.route}/`),
    );
    if (matched) return matched.domain;
    return null;
  }, [pathname, visibleModules]);

  // 按域分组（仅保留有可见模块的域）
  const groups = useMemo(() => {
    const byDomain = new Map<ModuleDomain, FrontendModule[]>();
    for (const m of visibleModules) {
      const list = byDomain.get(m.domain) ?? [];
      list.push(m);
      byDomain.set(m.domain, list);
    }
    return MODULE_DOMAINS.map((d) => ({
      domain: d,
      modules: (byDomain.get(d.id) ?? []).sort((a, b) => a.order - b.order),
    })).filter((g) => g.modules.length > 0);
  }, [visibleModules]);

  const isCollapsed = (domainId: ModuleDomain): boolean =>
    domainId !== currentDomain && collapsed.has(domainId);

  const toggleDomain = (domainId: ModuleDomain) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(domainId)) next.delete(domainId);
      else next.add(domainId);
      return next;
    });
  };

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto p-4">
      {groups.map(({ domain, modules }) => {
        const collapsedDomain = isCollapsed(domain.id);
        return (
          <div key={domain.id} className="flex flex-col">
            <button
              type="button"
              onClick={() => toggleDomain(domain.id)}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100"
            >
              <span>{domain.label}</span>
              <span className="text-xs text-slate-400">{collapsedDomain ? "▸" : "▾"}</span>
            </button>
            {!collapsedDomain && (
              <div className="mt-1 flex flex-col gap-1 pl-2">
                {modules.map((item) => {
                  const active =
                    pathname === item.route || pathname.startsWith(`${item.route}/`);
                  if (item.availability === "hold") {
                    // HOLD：明确视觉区分，不可点击（禁止假功能入口）
                    return (
                      <span
                        key={item.id}
                        className="flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-slate-300"
                        aria-disabled="true"
                      >
                        <span>{item.label}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">
                          尚未开放
                        </span>
                      </span>
                    );
                  }
                  return (
                    <Link
                      key={item.id}
                      href={item.route}
                      className={`rounded-md px-3 py-2 text-sm font-medium ${
                        active
                          ? "bg-brand-50 text-brand-700"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
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

      {/* Footer — 发布版本 = ERP Release SSOT（RELEASE_VERSION manifest）；Web package version 不再展示为“系统版本” */}
      <footer className="border-t border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-400">
        <p>{APP_NAME} · {process.env.NEXT_PUBLIC_RELEASE_VERSION ?? "-"}</p>
        <p className="mt-0.5">
          Build: {process.env.NEXT_PUBLIC_BUILD_ID ?? "-"} · Git Commit: {process.env.NEXT_PUBLIC_GIT_SHA ?? "-"} ·
          Deployment: {process.env.NEXT_PUBLIC_DEPLOYMENT_ENV ?? "-"}
        </p>
      </footer>
    </div>
  );
}
