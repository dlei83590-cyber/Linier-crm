"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { hasPermission, APP_NAME, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import {
  modulesByDomainGrouped,
  type FrontendModule,
  type ModuleDomain,
} from "@/lib/frontend/modules";

/**
 * Admin Shell — Frontend Productization Reset F2-0（IA v2）+ F2-5A（Navigation Reset）
 *
 * 导航唯一事实来源 = Module Registry（apps/web/src/lib/frontend/modules.ts）。
 * 废除旧的一维 NAV_ITEMS 数组；Sidebar / 移动菜单均消费同一份 Registry 投影。
 *
 * F2-5A 规则（CTO #12521/#12522）：
 * - 一级域分组（9 域，顺序见 MODULE_DOMAINS）；**当前业务域自动展开，其他域默认折叠**
 * - **Ready 模块正常显示可点击；Hold 模块合并为域内折叠组「规划中 · N」，
 *   用户主动展开后才看到，且仍然全部不可点击**（HOLD 不再平铺污染主业务导航）
 * - Sidebar 固定高度 + 内部独立滚动，Main Content 不受 Sidebar 高度影响
 * - 无权限 item 不出现（permission 为 null 或 hasPermission 通过）
 * - 真实可用页面（ready）显示正常业务名称
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const { state, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  // F2-5A：默认只展开当前域；expanded 记录用户额外展开的域
  const [expanded, setExpanded] = useState<ReadonlySet<ModuleDomain>>(new Set());
  // F2-5A：域内 hold 折叠组（默认折叠）
  const [holdOpen, setHoldOpen] = useState<ReadonlySet<ModuleDomain>>(new Set());

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/login");
    }
  }, [state.status, router]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const roles = (state.user?.roles ?? []) as RoleCode[];

  // 权限过滤后的可见模块（唯一事实源 = Registry 投影）
  const visibleGroups = useMemo(() => {
    const groups = modulesByDomainGrouped();
    const visible = (ms: FrontendModule[]) =>
      ms.filter((m) => m.permission === null || hasPermission(roles, m.permission));
    return groups
      .map((g) => ({
        domain: g.domain,
        ready: visible(g.ready),
        preview: visible(g.preview),
        hold: visible(g.hold),
      }))
      .filter((g) => g.ready.length > 0 || g.preview.length > 0 || g.hold.length > 0);
  }, [roles]);

  // 当前业务域（根据 pathname 匹配 route 前缀；未命中时默认展开第一个非空域）
  const currentDomain = useMemo<ModuleDomain | null>(() => {
    const matched = visibleGroups
      .flatMap((g) => [...g.ready, ...g.preview, ...g.hold])
      .find((m) => pathname === m.route || pathname.startsWith(`${m.route}/`));
    if (matched) return matched.domain;
    return visibleGroups[0]?.domain.id ?? null;
  }, [pathname, visibleGroups]);

  // 域展开：当前域始终展开；其他域默认折叠，用户点击加入 expanded
  const isDomainExpanded = (domainId: ModuleDomain): boolean =>
    domainId === currentDomain || expanded.has(domainId);
  const toggleDomain = (domainId: ModuleDomain) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(domainId)) next.delete(domainId);
      else next.add(domainId);
      return next;
    });
  };

  // 域内 hold 折叠组
  const isHoldOpen = (domainId: ModuleDomain): boolean => holdOpen.has(domainId);
  const toggleHold = (domainId: ModuleDomain) => {
    setHoldOpen((prev) => {
      const next = new Set(prev);
      if (next.has(domainId)) next.delete(domainId);
      else next.add(domainId);
      return next;
    });
  };

  if (state.status !== "authenticated" || !state.user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">加载中…</p>
      </div>
    );
  }

  const user = state.user;

  const renderModuleLink = (item: FrontendModule, badge?: string) => {
    const active = pathname === item.route || pathname.startsWith(`${item.route}/`);
    return (
      <Link
        key={item.id}
        href={item.route}
        className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium ${
          active
            ? "bg-brand-50 text-brand-700"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        <span>{item.label}</span>
        {badge && (
          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-600">{badge}</span>
        )}
      </Link>
    );
  };

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-4">
      {visibleGroups.map(({ domain, ready, preview, hold }) => {
        const domainExpanded = isDomainExpanded(domain.id);
        const holdExpanded = isHoldOpen(domain.id);
        return (
          <div key={domain.id} className="flex flex-col">
            <button
              type="button"
              onClick={() => toggleDomain(domain.id)}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100"
            >
              <span>{domain.label}</span>
              <span className="text-xs text-slate-400">{domainExpanded ? "▾" : "▸"}</span>
            </button>
            {domainExpanded && (
              <div className="mt-1 flex flex-col gap-1 pl-2">
                {/* Ready 模块：正常显示可点击 */}
                {ready.map((m) => renderModuleLink(m))}
                {/* Preview 模块：与 ready 同为主导航，带「预览」标记（只读 Preview，不归入 hold，CTO #12686） */}
                {preview.map((m) => renderModuleLink(m, "预览"))}
                {/* Hold 模块：折叠组「规划中 · N」，展开后仍不可点击 */}
                {hold.length > 0 && (
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => toggleHold(domain.id)}
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-slate-400 hover:bg-slate-100"
                    >
                      <span>规划中 · {hold.length}</span>
                      <span className="text-xs text-slate-300">{holdExpanded ? "▾" : "▸"}</span>
                    </button>
                    {holdExpanded && (
                      <div className="mt-1 flex flex-col gap-1 pl-2">
                        {hold.map((item) => (
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
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
        {/* Desktop sidebar：F2-5A 固定高度 + 内部独立滚动，Main Content 不受 Sidebar 高度影响 */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 overflow-y-auto border-r border-slate-200 bg-white md:block">
          {sidebar}
        </aside>

        {/* Mobile sidebar */}
        {menuOpen && (
          <div className="fixed inset-0 z-30 md:hidden">
            <button
              type="button"
              aria-label="关闭菜单"
              className="absolute inset-0 bg-slate-900/30"
              onClick={() => setMenuOpen(false)}
            />
            <aside className="absolute inset-y-0 left-0 w-56 overflow-y-auto bg-white shadow-lg">{sidebar}</aside>
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
