'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { hasPermission, APP_NAME, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import {
  modulesByDomainGrouped,
  type FrontendModule,
  type ModuleDomain,
} from "@/lib/frontend/modules";
import { MODULE_ACCENT_MAP } from "@/components/design-system";
import { Skeleton } from "@/components/ui/skeleton";
import { useTableDensity } from "@/lib/table-density-context";

/**
 * Admin Shell — F2-0（IA v2）+ F2-5A（Navigation Reset）+ Sprint8 U1 高饱和彩色仪表盘壳层交互
 *
 * 导航唯一事实来源 = Module Registry（apps/web/src/lib/frontend/modules.ts）。
 *
 * Sprint8 U1：
 * - U1.1 侧栏折叠（桌面，localStorage 记忆，折叠为 64px 色块轨道）
 * - U1.2 当前项左侧域色指示条 + 域色浅底激活
 * - U1.3 域分组色点 + chevron 旋转过渡（当前域自动展开）
 * - U1.4 移动端抽屉滑入动画 + backdrop blur
 * - U1.5 顶栏模块搜索（/ 快捷键聚焦；Enter 直达首项；当前模块域色徽标）
 */

const SIDEBAR_STORAGE_KEY = "linier.sidebar.collapsed";

/** Tailwind 字面量域色类（JIT 无法扫描动态类名，必须静态注册；与 tokens.ts MODULE_ACCENTS 一一对应） */
interface DomainClassSet {
  dot: string;
  soft: string;
  text: string;
  indicator: string;
  square: string;
}

const DOMAIN_CLASS: Record<string, DomainClassSet> = {
  workbench: { dot: "bg-domain-workbench-500", soft: "bg-domain-workbench-50", text: "text-domain-workbench-600", indicator: "bg-domain-workbench-600", square: "bg-domain-workbench-100 text-domain-workbench-700" },
  "customer-project": { dot: "bg-domain-customer-project-500", soft: "bg-domain-customer-project-50", text: "text-domain-customer-project-600", indicator: "bg-domain-customer-project-600", square: "bg-domain-customer-project-100 text-domain-customer-project-700" },
  sales: { dot: "bg-domain-sales-500", soft: "bg-domain-sales-50", text: "text-domain-sales-600", indicator: "bg-domain-sales-600", square: "bg-domain-sales-100 text-domain-sales-700" },
  purchasing: { dot: "bg-domain-purchasing-500", soft: "bg-domain-purchasing-50", text: "text-domain-purchasing-600", indicator: "bg-domain-purchasing-600", square: "bg-domain-purchasing-100 text-domain-purchasing-700" },
  inventory: { dot: "bg-domain-inventory-500", soft: "bg-domain-inventory-50", text: "text-domain-inventory-600", indicator: "bg-domain-inventory-600", square: "bg-domain-inventory-100 text-domain-inventory-700" },
  "supplier-ap": { dot: "bg-domain-supplier-ap-500", soft: "bg-domain-supplier-ap-50", text: "text-domain-supplier-ap-600", indicator: "bg-domain-supplier-ap-600", square: "bg-domain-supplier-ap-100 text-domain-supplier-ap-700" },
  finance: { dot: "bg-domain-finance-500", soft: "bg-domain-finance-50", text: "text-domain-finance-600", indicator: "bg-domain-finance-600", square: "bg-domain-finance-100 text-domain-finance-700" },
  "master-data": { dot: "bg-domain-master-data-500", soft: "bg-domain-master-data-50", text: "text-domain-master-data-600", indicator: "bg-domain-master-data-600", square: "bg-domain-master-data-100 text-domain-master-data-700" },
  system: { dot: "bg-domain-system-500", soft: "bg-domain-system-50", text: "text-domain-system-600", indicator: "bg-domain-system-600", square: "bg-domain-system-100 text-domain-system-700" },
  reports: { dot: "bg-domain-reports-500", soft: "bg-domain-reports-50", text: "text-domain-reports-600", indicator: "bg-domain-reports-600", square: "bg-domain-reports-100 text-domain-reports-700" },
};

function domainClass(domainId: string): DomainClassSet {
  return DOMAIN_CLASS[domainId] ?? DOMAIN_CLASS.workbench;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { state, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  // F2-5A：默认只展开当前域；expanded 记录用户额外展开的域
  const [expanded, setExpanded] = useState<ReadonlySet<ModuleDomain>>(new Set());
  // F2-5A：域内 hold 折叠组（默认折叠）
  const [holdOpen, setHoldOpen] = useState<ReadonlySet<ModuleDomain>>(new Set());
  // U1.1：侧栏折叠（桌面）
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  });
  // U1.5：顶栏模块搜索
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // U5：全局密度切换
  const { density, setDensity } = useTableDensity();

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/login");
    }
  }, [state.status, router]);

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [pathname]);

  // U1.1：折叠偏好持久化
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }, [collapsed]);

  // U1.5：/ 快捷键聚焦搜索；输入态不劫持
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // U1.5：点击外部关闭搜索结果
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

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

  // 当前模块（顶栏徽标；仅 ready/preview）
  const currentModule = useMemo<{ module: FrontendModule; domainId: string } | null>(() => {
    const hit = visibleGroups
      .flatMap((g) => [
        ...g.ready.map((m) => ({ module: m, domainId: g.domain.id })),
        ...g.preview.map((m) => ({ module: m, domainId: g.domain.id })),
      ])
      .find(({ module }) => pathname === module.route || pathname.startsWith(`${module.route}/`));
    return hit ?? null;
  }, [pathname, visibleGroups]);

  // U1.5：搜索候选（ready/preview 可跳转；hold 仅展示）
  const searchCandidates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return visibleGroups
      .flatMap((g) => [
        ...g.ready.map((m) => ({ module: m, domainId: g.domain.id, available: true })),
        ...g.preview.map((m) => ({ module: m, domainId: g.domain.id, available: true })),
        ...g.hold.map((m) => ({ module: m, domainId: g.domain.id, available: false })),
      ])
      .filter(({ module, domainId }) => {
        const accent = MODULE_ACCENT_MAP[domainId];
        const domainLabel = accent ? accent.label : domainId;
        return module.label.toLowerCase().includes(q) || domainLabel.toLowerCase().includes(q);
      })
      .slice(0, 12);
  }, [searchQuery, visibleGroups]);

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
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="w-64 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
        </div>
      </div>
    );
  }

  const user = state.user;

  // U1.2/U1.3：模块链接（折叠态为色块；展开态带域色指示条）
  const renderModuleLink = (item: FrontendModule, domainId: string, badge?: string) => {
    const active = pathname === item.route || pathname.startsWith(`${item.route}/`);
    const dc = domainClass(domainId);
    if (collapsed) {
      return (
        <Link
          key={item.id}
          href={item.route}
          title={item.label}
          aria-label={item.label}
          className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
            active ? dc.soft : "text-ink-secondary hover:bg-slate-100"
          }`}
        >
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold ${
              active ? `${dc.square} shadow-elevation-sm` : "bg-slate-100 text-ink-muted"
            }`}
          >
            {item.label.slice(0, 1)}
          </span>
        </Link>
      );
    }
    return (
      <Link
        key={item.id}
        href={item.route}
        className={`relative flex items-center justify-between rounded-md py-2 pl-3 pr-2 text-sm font-medium transition-colors ${
          active
            ? `${dc.soft} text-ink-primary shadow-elevation-sm`
            : "text-ink-secondary hover:bg-slate-100 hover:text-ink-primary"
        }`}
      >
        {active && (
          <span
            className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full ${dc.indicator}`}
            aria-hidden="true"
          />
        )}
        <span className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${active ? dc.dot : "bg-slate-300"}`} aria-hidden="true" />
          <span className="truncate">{item.label}</span>
        </span>
        {badge && (
          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-600">{badge}</span>
        )}
      </Link>
    );
  };

  // U1.1/U1.3：侧栏内容（折叠态为色块轨道；展开态保留域分组）
  const sidebar = collapsed ? (
    <nav className="flex h-full flex-col items-center gap-1 p-3">
      {visibleGroups.map(({ domain, ready, preview }) => {
        const dc = domainClass(domain.id);
        return (
          <div key={domain.id} className="flex flex-col items-center gap-1">
            <span
              title={domain.label}
              aria-label={domain.label}
              className={`h-2.5 w-2.5 rounded-full ${dc.dot} my-1`}
            />
            {[...ready, ...preview].map((m) => renderModuleLink(m, domain.id))}
          </div>
        );
      })}
    </nav>
  ) : (
    <nav className="flex h-full flex-col gap-1 p-4">
      {visibleGroups.map(({ domain, ready, preview, hold }) => {
        const domainExpanded = isDomainExpanded(domain.id);
        const holdExpanded = isHoldOpen(domain.id);
        const dc = domainClass(domain.id);
        return (
          <div key={domain.id} className="flex flex-col">
            <button
              type="button"
              onClick={() => toggleDomain(domain.id)}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-semibold text-ink-secondary transition-colors hover:bg-slate-100 hover:text-ink-primary"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${dc.dot}`} aria-hidden="true" />
                <span className="truncate">{domain.label}</span>
              </span>
              <svg
                className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${domainExpanded ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            {domainExpanded && (
              <div className="mt-1 flex flex-col gap-1 pl-2">
                {ready.map((m) => renderModuleLink(m, domain.id))}
                {preview.map((m) => renderModuleLink(m, domain.id, "预览"))}
                {hold.length > 0 && (
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => toggleHold(domain.id)}
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-slate-100"
                    >
                      <span>规划中 · {hold.length}</span>
                      <span
                        className={`text-xs text-slate-300 transition-transform duration-200 ${holdExpanded ? "rotate-90" : ""}`}
                      >
                        ▸
                      </span>
                    </button>
                    {holdExpanded && (
                      <div className="mt-1 flex flex-col gap-1 pl-2">
                        {hold.map((item) => (
                          <span
                            key={item.id}
                            className="flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-ink-muted/70"
                            aria-disabled="true"
                          >
                            <span>{item.label}</span>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-ink-muted">
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

  // U1.5：搜索结果下拉
  const searchDropdown = searchOpen && searchQuery.trim() ? (
    <div className="absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-elevation-lg">
      {searchCandidates.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-muted">无匹配模块</p>
      ) : (
        <ul className="max-h-80 overflow-y-auto py-1">
          {searchCandidates.map(({ module: m, domainId, available }) => {
            const dc = domainClass(domainId);
            return (
              <li key={m.id}>
                {available ? (
                  <Link
                    href={m.route}
                    onClick={() => {
                      setSearchQuery("");
                      setSearchOpen(false);
                    }}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-ink-primary transition-colors hover:bg-slate-50"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${dc.dot}`} aria-hidden="true" />
                    <span className="font-medium">{m.label}</span>
                    <span className="text-xs text-ink-muted">{MODULE_ACCENT_MAP[domainId]?.label ?? domainId}</span>
                  </Link>
                ) : (
                  <span className="flex cursor-not-allowed items-center gap-2 px-4 py-2 text-sm text-ink-muted">
                    <span className={`h-1.5 w-1.5 rounded-full ${dc.dot}`} aria-hidden="true" />
                    <span>{m.label}</span>
                    <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">尚未开放</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-canvas">
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-surface px-4 shadow-elevation-sm">
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
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="hidden rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 md:block"
            aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
            title={collapsed ? "展开侧栏" : "折叠侧栏"}
          >
            <svg
              className={`h-5 w-5 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-elevation-sm">
              利
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-ink-primary">利尼尔 CRM 管理系统</span>
              <span className="text-[10px] text-ink-muted">Linier ERP</span>
            </div>
          </div>
        </div>

        {/* U1.5：顶栏模块搜索 + 当前模块域色徽标 */}
        <div className="hidden flex-1 justify-center px-4 md:flex">
          <div ref={searchRef} className="relative w-full max-w-sm">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchCandidates.length > 0) {
                  const first = searchCandidates.find((c) => c.available);
                  if (first) {
                    router.push(first.module.route);
                    setSearchQuery("");
                    setSearchOpen(false);
                  }
                }
                if (e.key === "Escape") {
                  setSearchOpen(false);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="搜索模块…（按 / 聚焦）"
              className="w-full rounded-md border border-border bg-canvas py-1.5 pl-8 pr-3 text-sm text-ink-primary placeholder:text-ink-muted focus:border-brand-500 focus:outline-none"
              aria-label="搜索模块"
            />
            {searchDropdown}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {currentModule && (
            <span
              className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium lg:flex ${domainClass(currentModule.domainId).soft} ${domainClass(currentModule.domainId).text}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${domainClass(currentModule.domainId).dot}`} aria-hidden="true" />
              {currentModule.module.label}
            </span>
          )}
          <button
            type="button"
            onClick={() => setDensity(density === "compact" ? "default" : "compact")}
            title={density === "compact" ? "切换为标准密度" : "切换为紧凑密度"}
            className="hidden items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-ink-muted transition-colors hover:bg-slate-100 hover:text-ink-primary md:flex"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
            </svg>
            <span>{density === "compact" ? "标准" : "紧凑"}</span>
          </button>
          <Link
            href="/profile"
            className="hidden items-center gap-2 text-sm text-ink-secondary transition-colors hover:text-ink-primary sm:flex"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
              {(user.name ?? user.email ?? "用").slice(0, 1).toUpperCase()}
            </span>
            <span className="max-w-[180px] truncate">{user.email}</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-slate-100 hover:text-ink-primary"
          >
            退出
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl">
        {/* Desktop sidebar：F2-5A 固定高度 + 内部独立滚动；U1.1 折叠轨道 */}
        <aside
          className={`sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 overflow-y-auto border-r border-border bg-surface transition-[width] duration-200 md:block ${
            collapsed ? "w-16" : "w-56"
          }`}
        >
          {sidebar}
        </aside>

        {/* Mobile sidebar：U1.4 抽屉滑入动画 + backdrop blur */}
        {menuOpen && (
          <div className="fixed inset-0 z-30 md:hidden">
            <button
              type="button"
              aria-label="关闭菜单"
              className="animate-fade-in absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]"
              onClick={() => setMenuOpen(false)}
            />
            <aside className="animate-drawer-in absolute inset-y-0 left-0 w-64 overflow-y-auto bg-surface shadow-elevation-lg">
              {sidebar}
            </aside>
          </div>
        )}

        {/* U3.2 页面切换淡入：pathname 变化时重挂载 + fade-in（search param 变化不重挂载） */}
        <main key={pathname} className="animate-fade-in min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>

      {/* Footer — 发布版本 = ERP Release SSOT（RELEASE_VERSION manifest）；Web package version 不再展示为“系统版本” */}
      <footer className="border-t border-border bg-surface px-4 py-3 text-center text-xs text-ink-muted">
        <p>{APP_NAME} · {process.env.NEXT_PUBLIC_RELEASE_VERSION ?? "-"}</p>
        <p className="mt-0.5 text-ink-muted/80">
          Build: {process.env.NEXT_PUBLIC_BUILD_ID ?? "-"} · Git Commit: {process.env.NEXT_PUBLIC_GIT_SHA ?? "-"} ·
          Deployment: {process.env.NEXT_PUBLIC_DEPLOYMENT_ENV ?? "-"}
        </p>
      </footer>
    </div>
  );
}