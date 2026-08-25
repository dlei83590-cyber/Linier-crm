'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { APP_NAME, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import type { FrontendModule, ModuleDomain } from "@/lib/frontend/modules";
import {
  filterVisibleGroups,
  parseCollapsedPreference,
  quickCreateItems,
  resolveCurrentDomain,
  resolveCurrentModule,
  SIDEBAR_STORAGE_KEY,
} from "@/lib/frontend/shell";
import { MODULE_ACCENT_MAP } from "@/components/design-system";
import { domainClass } from "@/components/design-system/domain-class";
import { DomainIcon, ModuleIcon } from "./module-icons";
import { Skeleton } from "@/components/ui/skeleton";
import { CommandPalette } from "./command-palette";
import { useTableDensity } from "@/lib/table-density-context";

/**
 * Admin Shell — UI-02 Frontend Experience 2.0（App Shell 重做）
 *
 * 导航唯一事实来源 = Module Registry（apps/web/src/lib/frontend/modules.ts，只读消费）。
 * 派生逻辑收敛到 lib/frontend/shell.ts 纯函数（可单测）。
 *
 * - Sidebar：折叠（200ms width 过渡 + 内容 fade-in；localStorage 记忆）、每域/每模块
 *   Lucide 风格图标、active 域色浅底 + Accent 指示条、hover 150ms 背景过渡、
 *   当前域优先展开（手风琴互斥）、hold 折叠组
 * - Header：左 = 品牌 + 当前域/模块 Breadcrumb；中 = 全局模块搜索（/ 快捷键）+ Ctrl+K 命令面板；
 *   右 = 快捷创建（Registry ui.create + createRoute + createPermission 权限门）、用户菜单、退出
 * - Mobile：Sidebar → Drawer（drawer-in 动画 + backdrop blur）；顶部 = menu + 页面标题 + 快捷创建主操作
 * - Footer：保留发布版本信息（NEXT_PUBLIC_RELEASE_VERSION / BUILD_ID / GIT_SHA / DEPLOYMENT_ENV）
 */

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { state, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  // 手风琴：同时只展开一个域（当前域始终展开）
  const [expandedDomain, setExpandedDomain] = useState<ModuleDomain | null>(null);
  // 域内 hold 折叠组（默认折叠）
  const [holdOpen, setHoldOpen] = useState<ReadonlySet<ModuleDomain>>(new Set());
  // 侧栏折叠（桌面；localStorage 记忆）
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return parseCollapsedPreference(window.localStorage.getItem(SIDEBAR_STORAGE_KEY));
  });
  // 顶栏模块搜索
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // 命令面板（Ctrl+K / ⌘K）
  const [paletteOpen, setPaletteOpen] = useState(false);
  // 快捷创建菜单
  const [createOpen, setCreateOpen] = useState(false);
  const createRef = useRef<HTMLDivElement>(null);
  // 用户菜单
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);
  // 全局密度切换
  const { density, setDensity } = useTableDensity();

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/login");
    }
  }, [state.status, router]);

  // 路由变化：收起移动抽屉 / 搜索 / 下拉菜单
  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
    setCreateOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  // 折叠偏好持久化
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }, [collapsed]);

  // / 快捷键聚焦搜索；输入态不劫持
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

  // 点击搜索框外部关闭
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // 点击快捷创建菜单外部关闭
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (createRef.current && !createRef.current.contains(e.target as Node)) {
        setCreateOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // 点击用户菜单外部关闭
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Ctrl+K / ⌘K 呼出命令面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const roles = (state.user?.roles ?? []) as RoleCode[];

  // 权限过滤后的可见模块（唯一事实源 = Registry 投影；纯函数在 lib/frontend/shell.ts）
  const visibleGroups = useMemo(() => filterVisibleGroups(roles), [roles]);

  // 当前业务域（路径前缀匹配；未命中回退第一个非空域）
  const currentDomain = useMemo(() => resolveCurrentDomain(pathname, visibleGroups), [pathname, visibleGroups]);

  // 当前模块（顶栏 Breadcrumb / 移动端标题）
  const currentModule = useMemo(() => resolveCurrentModule(pathname, visibleGroups), [pathname, visibleGroups]);

  // 快捷创建投影（Registry ui.create + createRoute + createPermission + 权限门）
  const quickCreate = useMemo(() => quickCreateItems(roles, visibleGroups), [roles, visibleGroups]);

  // 搜索候选（ready/preview 可跳转；hold 仅展示）
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

  // 域展开（手风琴）：当前域始终展开；用户点击域互斥展开
  const isDomainExpanded = (domainId: ModuleDomain): boolean =>
    domainId === currentDomain?.id || expandedDomain === domainId;
  const toggleDomain = (domainId: ModuleDomain) => {
    setExpandedDomain((prev) => (prev === domainId ? null : domainId));
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

  // 模块链接（展开态：图标 + label + Accent 指示条；折叠态：图标轨道）
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
          className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-150 ${
            active ? `${dc.soft} text-ink-primary` : "text-ink-muted hover:bg-slate-100 hover:text-ink-primary"
          }`}
        >
          <ModuleIcon moduleId={item.id} className="h-[18px] w-[18px]" />
        </Link>
      );
    }
    return (
      <Link
        key={item.id}
        href={item.route}
        className={`group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-150 ${
          active
            ? `${dc.soft} text-ink-primary`
            : "text-ink-secondary hover:bg-slate-50 hover:text-ink-primary"
        }`}
        aria-current={active ? "page" : undefined}
      >
        {active && (
          <span
            className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full ${dc.indicator}`}
            aria-hidden="true"
          />
        )}
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
            active ? `${dc.square}` : "bg-slate-100 text-ink-muted transition-colors duration-150 group-hover:bg-slate-200/70"
          }`}
        >
          <ModuleIcon moduleId={item.id} className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {badge && (
          <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-600">{badge}</span>
        )}
      </Link>
    );
  };

  // 侧栏内容（折叠态为图标轨道；展开态保留域分组 + 图标）
  const sidebar = collapsed ? (
    <nav className="flex h-full flex-col items-center gap-1 px-2.5 py-3">
      {visibleGroups.map(({ domain, ready, preview }) => {
        const dc = domainClass(domain.id);
        return (
          <div key={domain.id} className="flex flex-col items-center gap-1">
            <span
              title={domain.label}
              aria-label={domain.label}
              className={`mt-1 h-1.5 w-1.5 rounded-full ${dc.dot}`}
            />
            {[...ready, ...preview].map((m) => renderModuleLink(m, domain.id))}
          </div>
        );
      })}
    </nav>
  ) : (
    <nav className="flex h-full flex-col gap-0.5 p-3">
      {visibleGroups.map(({ domain, ready, preview, hold }) => {
        const domainExpanded = isDomainExpanded(domain.id);
        const holdExpanded = isHoldOpen(domain.id);
        const dc = domainClass(domain.id);
        return (
          <div key={domain.id} className="flex flex-col">
            <button
              type="button"
              onClick={() => toggleDomain(domain.id)}
              aria-expanded={domainExpanded}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-semibold transition-colors duration-150 ${
                domainExpanded ? "bg-slate-50 text-ink-primary" : "text-ink-secondary hover:bg-slate-50 hover:text-ink-primary"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors duration-150 ${
                  domainExpanded ? `${dc.soft}` : "bg-slate-100"
                }`}
              >
                <DomainIcon domainId={domain.id} className={`h-3.5 w-3.5 ${domainExpanded ? dc.text : "text-ink-muted"}`} />
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{domain.label}</span>
              <svg
                className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 ${domainExpanded ? "rotate-90" : ""}`}
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
              <div className="mt-0.5 flex flex-col gap-0.5 pl-2">
                {ready.map((m) => renderModuleLink(m, domain.id))}
                {preview.map((m) => renderModuleLink(m, domain.id, "预览"))}
                {hold.length > 0 && (
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => toggleHold(domain.id)}
                      className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm font-medium text-ink-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink-secondary"
                    >
                      <span>规划中 · {hold.length}</span>
                      <span
                        className={`text-xs text-slate-300 transition-transform duration-200 ${holdExpanded ? "rotate-90" : ""}`}
                      >
                        ▸
                      </span>
                    </button>
                    {holdExpanded && (
                      <div className="mt-0.5 flex flex-col gap-0.5 pl-2">
                        {hold.map((item) => (
                          <span
                            key={item.id}
                            className="flex items-center justify-between rounded-md px-2.5 py-2 text-sm font-medium text-ink-muted/70"
                            aria-disabled="true"
                          >
                            <span className="flex min-w-0 items-center gap-2.5">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-ink-muted">
                                <ModuleIcon moduleId={item.id} className="h-3.5 w-3.5" />
                              </span>
                              <span className="truncate">{item.label}</span>
                            </span>
                            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-ink-muted">
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

  // 搜索下拉
  const searchDropdown = searchOpen && searchQuery.trim() ? (
    <div className="absolute right-0 top-full z-50 mt-1.5 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-elevation-lg">
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
                    className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink-primary transition-colors duration-150 hover:bg-slate-50"
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${dc.soft}`}>
                      <ModuleIcon moduleId={m.id} className={`h-3 w-3 ${dc.text}`} />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{m.label}</span>
                    <span className="shrink-0 text-xs text-ink-muted">{MODULE_ACCENT_MAP[domainId]?.label ?? domainId}</span>
                  </Link>
                ) : (
                  <span className="flex cursor-not-allowed items-center gap-2.5 px-4 py-2 text-sm text-ink-muted">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${dc.soft}`}>
                      <ModuleIcon moduleId={m.id} className={`h-3 w-3 ${dc.text}`} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{m.label}</span>
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">尚未开放</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  ) : null;

  const domainLabel = currentDomain
    ? (MODULE_ACCENT_MAP[currentDomain.id]?.label ?? currentDomain.label)
    : null;

  // 移动端页面标题
  const mobileTitle = currentModule?.module.label ?? domainLabel ?? "Linier CRM";

  const handleLogout = () => {
    logout();
    router.replace("/login");
  };

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-surface px-3 shadow-elevation-sm md:px-4">
        {/* 左：移动 menu + 桌面折叠 + Breadcrumb（域 / 模块）；移动端 = 页面标题 */}
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            className="rounded-md p-2 text-ink-secondary transition-colors duration-150 hover:bg-slate-100 md:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="切换菜单"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="hidden rounded-md p-2 text-ink-secondary transition-colors duration-150 hover:bg-slate-100 md:block"
            aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
            title={collapsed ? "展开侧栏" : "折叠侧栏"}
          >
            <svg
              className={`h-5 w-5 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Breadcrumb（md+） */}
          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white shadow-elevation-sm">
              利
            </span>
            <div className="flex min-w-0 items-center gap-1.5 text-sm">
              <span className="truncate font-semibold text-ink-primary">{domainLabel ?? "Linier CRM"}</span>
              {currentModule && (
                <>
                  <svg
                    className="h-3.5 w-3.5 shrink-0 text-ink-muted"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="truncate text-ink-secondary">{currentModule.module.label}</span>
                </>
              )}
            </div>
          </div>

          {/* 移动端页面标题 */}
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-primary md:hidden">{mobileTitle}</h1>
        </div>

        {/* 中：全局模块搜索 + Ctrl+K 命令面板（md+） */}
        <div className="hidden flex-1 justify-center px-4 md:flex">
          <div ref={searchRef} className="relative w-full max-w-sm">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
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
              className="w-full rounded-md border border-border bg-canvas py-1.5 pl-8 pr-3 text-sm text-ink-primary placeholder:text-ink-muted transition-colors duration-150 focus:border-brand-500 focus:outline-none"
              aria-label="搜索模块"
            />
            {searchDropdown}
          </div>
        </div>

        {/* 右：快捷创建 + 命令面板 + 用户菜单 */}
        <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
          {/* 快捷创建（消费 Registry ui.create + createRoute + createPermission 权限门） */}
          {quickCreate.length > 0 && (
            <div ref={createRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setCreateOpen((o) => !o);
                  setUserMenuOpen(false);
                }}
                aria-expanded={createOpen}
                aria-haspopup="menu"
                title="快捷创建"
                className="flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                </svg>
                <span className="hidden lg:inline">新建</span>
              </button>
              {createOpen && (
                <div className="animate-dialog-in absolute right-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-elevation-lg">
                  <p className="border-b border-border px-3 py-2 text-xs font-medium text-ink-muted">快捷创建</p>
                  <ul className="max-h-80 overflow-y-auto py-1">
                    {quickCreate.map(({ module: m, domainId }) => {
                      const dc = domainClass(domainId);
                      return (
                        <li key={m.id}>
                          <Link
                            href={m.createRoute ?? m.route}
                            onClick={() => setCreateOpen(false)}
                            className="flex items-center gap-2.5 px-3 py-2 text-sm text-ink-primary transition-colors duration-150 hover:bg-slate-50"
                          >
                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${dc.soft}`}>
                              <ModuleIcon moduleId={m.id} className={`h-3.5 w-3.5 ${dc.text}`} />
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium">{m.label}</span>
                            <span className="shrink-0 text-[11px] text-ink-muted">
                              {MODULE_ACCENT_MAP[domainId]?.label ?? domainId}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Ctrl+K 命令面板触发（md+） */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title="命令面板（Ctrl+K）"
            className="hidden items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-ink-muted transition-colors duration-150 hover:bg-slate-100 hover:text-ink-primary md:flex"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="font-medium">Ctrl K</span>
          </button>

          {/* 用户菜单（个人信息 / 界面密度 / 退出） */}
          <div ref={userRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setUserMenuOpen((o) => !o);
                setCreateOpen(false);
              }}
              aria-expanded={userMenuOpen}
              aria-haspopup="menu"
              aria-label="用户菜单"
              className="flex items-center gap-1.5 rounded-md p-1 transition-colors duration-150 hover:bg-slate-100"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                {(user.name ?? user.email ?? "用").slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden max-w-[160px] truncate text-sm text-ink-secondary xl:block">
                {user.name ?? user.email}
              </span>
              <svg
                className={`hidden h-3.5 w-3.5 text-ink-muted transition-transform duration-200 xl:block ${userMenuOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {userMenuOpen && (
              <div className="animate-dialog-in absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-elevation-lg">
                <div className="border-b border-border px-3 py-2">
                  <p className="truncate text-sm font-medium text-ink-primary">{user.name ?? user.email}</p>
                  <p className="truncate text-xs text-ink-muted">{user.email}</p>
                </div>
                <Link
                  href="/profile"
                  onClick={() => setUserMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-ink-secondary transition-colors duration-150 hover:bg-slate-50 hover:text-ink-primary"
                >
                  <svg className="h-4 w-4 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <circle cx="12" cy="8" r="5" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 21a8 8 0 0 0-16 0" />
                  </svg>
                  个人信息
                </Link>
                <button
                  type="button"
                  onClick={() => setDensity(density === "compact" ? "default" : "compact")}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink-secondary transition-colors duration-150 hover:bg-slate-50 hover:text-ink-primary"
                >
                  <svg className="h-4 w-4 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                  界面密度：{density === "compact" ? "标准" : "紧凑"}
                </button>
                <div className="my-1 border-t border-border" />
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-rose-600 transition-colors duration-150 hover:bg-rose-50"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 17l5-5-5-5" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12H9" />
                  </svg>
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 内容区 */}
      <div className="flex w-full">
        {/* Desktop sidebar：折叠（200ms width 过渡）；图标轨道 / 域分组 */}
        <aside
          className={`sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 overflow-y-auto border-r border-border bg-surface transition-[width] duration-200 ease-out md:block ${
            collapsed ? "w-[60px]" : "w-60 xl:w-64"
          }`}
        >
          {sidebar}
        </aside>

        {/* Mobile sidebar：Drawer（drawer-in 动画 + backdrop blur） */}
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

        {/* 页面切换淡入：pathname 变化时重挂载 + fade-in（search param 变化不重挂载） */}
        <main key={pathname} className="animate-page-in min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>

      {/* Footer — 发布版本 = ERP Release SSOT（RELEASE_VERSION manifest）；Web package version 不再展示为“系统版本” */}
      <footer className="border-t border-border bg-surface px-4 py-3 text-center text-xs text-ink-muted">
        <p>{APP_NAME} · {process.env.NEXT_PUBLIC_RELEASE_VERSION ?? "-"}</p>
        <p className="mt-0.5 text-ink-muted/80">
          Build: {process.env.NEXT_PUBLIC_BUILD_ID ?? "-"} · Git Commit: {process.env.NEXT_PUBLIC_GIT_SHA ?? "-"} ·
          Deployment: {process.env.NEXT_PUBLIC_DEPLOYMENT_ENV ?? "-"}
        </p>
      </footer>

      {/* 命令面板（Ctrl+K / ⌘K；键盘导航 / Esc / backdrop 保留） */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        groups={visibleGroups}
      />
    </div>
  );
}
