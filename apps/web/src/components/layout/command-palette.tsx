'use client';

/**
 * CommandPalette — 命令面板（Sprint8 U4，Linear/Notion 式）
 *
 * - Ctrl+K / ⌘K 呼出（AdminShell 监听）；Esc / 点击 backdrop 关闭
 * - 搜索可见模块（label / 域 label），↑↓ 选择，Enter 跳转
 * - ready/preview 可跳转；hold 仅展示（不可点击）
 * - 域色点 + 域 label 副文本（高饱和彩色仪表盘风）
 * 候选投影来源 = Module Registry（与侧栏/顶栏搜索同一事实源）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FrontendModule, ModuleDomainDef } from "@/lib/frontend/modules";
import { MODULE_ACCENT_MAP } from "@/components/design-system";
import { domainClass } from "@/components/design-system/domain-class";
import { ModuleIcon } from "./module-icons";
import { Icon } from "@/components/ui/icon";

export interface PaletteGroup {
  domain: ModuleDomainDef;
  ready: FrontendModule[];
  preview: FrontendModule[];
  hold: FrontendModule[];
}

/** 最近访问条目（AdminShell 持久化到 localStorage "linier.recent" 后经 props 传入） */
export interface RecentVisit {
  route: string;
  label: string;
  domainLabel: string;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  groups: PaletteGroup[];
  /** 最近访问（可选；不传时行为与旧版一致） */
  recent?: RecentVisit[];
}

interface ModuleCandidate {
  kind: "module";
  module: FrontendModule;
  domainId: string;
  available: boolean;
}

interface RecentCandidate {
  kind: "recent";
  route: string;
  label: string;
  domainLabel: string;
}

type Candidate = ModuleCandidate | RecentCandidate;

export function CommandPalette({ open, onClose, groups, recent }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const candidates = useMemo<Candidate[]>(() => {
    const all: ModuleCandidate[] = groups.flatMap((g) => [
      ...g.ready.map((m) => ({ kind: "module" as const, module: m, domainId: g.domain.id, available: true })),
      ...g.preview.map((m) => ({ kind: "module" as const, module: m, domainId: g.domain.id, available: true })),
      ...g.hold.map((m) => ({ kind: "module" as const, module: m, domainId: g.domain.id, available: false })),
    ]);
    const q = query.trim().toLowerCase();
    if (!q) {
      // 最近访问并入候选数组最前（可 ↑↓ 选中 / Enter 跳转）
      const recents: RecentCandidate[] = (recent ?? []).map((v) => ({
        kind: "recent",
        route: v.route,
        label: v.label,
        domainLabel: v.domainLabel,
      }));
      return [...recents, ...all.slice(0, 12)];
    }
    return all
      .filter(({ module, domainId }) => {
        const accent = MODULE_ACCENT_MAP[domainId];
        const domainLabel = accent ? accent.label : domainId;
        return module.label.toLowerCase().includes(q) || domainLabel.toLowerCase().includes(q);
      })
      .slice(0, 12);
  }, [groups, query, recent]);

  // 最近访问条目按 route 恢复模块图标 / 域色（未命中 → history 兜底图标）
  const moduleByRoute = useMemo(() => {
    const map = new Map<string, { module: FrontendModule; domainId: string }>();
    for (const g of groups) {
      for (const m of [...g.ready, ...g.preview, ...g.hold]) {
        if (!map.has(m.route)) map.set(m.route, { module: m, domainId: g.domain.id });
      }
    }
    return map;
  }, [groups]);

  // 打开时聚焦 + 重置
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const go = (index: number) => {
    const item = candidates[index];
    if (!item) return;
    if (item.kind === "module" && !item.available) return;
    router.push(item.kind === "recent" ? item.route : item.module.route);
    onClose();
  };

  // 分组渲染开关：query 为空且有最近访问时，顶部展示「最近访问」+「全部模块」
  const showRecentGroup = query.trim() === "" && recent != null && recent.length > 0;
  const recentCount = showRecentGroup ? (recent ?? []).length : 0;

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center bg-scrim p-4 pt-[12vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="animate-dialog-in w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-elevation-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <svg
            className="h-4 w-4 shrink-0 text-ink-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, candidates.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(activeIndex);
              }
            }}
            placeholder="搜索模块…（↑↓ 选择，Enter 跳转）"
            className="w-full bg-transparent py-3 text-sm text-ink-primary outline-none placeholder:text-ink-muted"
            aria-label="搜索模块"
          />
        </div>
        <ul className="max-h-72 overflow-y-auto py-1">
          {candidates.length === 0 ? (
            <li className="px-4 py-3 text-sm text-ink-muted">无匹配模块</li>
          ) : (
            <>
              {showRecentGroup && (
                <li className="select-none px-4 pb-1 pt-2 text-xs font-medium text-ink-muted">最近访问</li>
              )}
              {candidates.slice(0, recentCount).map((c, i) => {
                if (c.kind !== "recent") return null;
                const hit = moduleByRoute.get(c.route);
                const dc = hit ? domainClass(hit.domainId) : null;
                const active = i === activeIndex;
                return (
                  <li key={`recent-${c.route}`}>
                    <button
                      type="button"
                      onClick={() => go(i)}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors duration-150 ${
                        active ? "bg-brand-50 text-ink-primary" : "text-ink-primary hover:bg-surface-hover"
                      }`}
                    >
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                        hit ? dc?.soft : "bg-canvas"
                      }`}>
                        {hit ? (
                          <ModuleIcon moduleId={hit.module.id} className={`h-3 w-3 ${dc?.text}`} />
                        ) : (
                          <Icon name="history" className="h-3 w-3 text-ink-muted" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{c.label}</span>
                      <span className="shrink-0 text-xs text-ink-muted">{c.domainLabel}</span>
                    </button>
                  </li>
                );
              })}
              {showRecentGroup && (
                <li className="select-none px-4 pb-1 pt-2 text-xs font-medium text-ink-muted">全部模块</li>
              )}
              {candidates.slice(recentCount).map((c, j) => {
                if (c.kind !== "module") return null;
                const { module: m, domainId, available } = c;
                const dc = domainClass(domainId);
                const active = recentCount + j === activeIndex;
                return (
                  <li key={m.id}>
                    {available ? (
                      <button
                        type="button"
                        onClick={() => go(recentCount + j)}
                        onMouseEnter={() => setActiveIndex(recentCount + j)}
                        className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors duration-150 ${
                          active ? "bg-brand-50 text-ink-primary" : "text-ink-primary hover:bg-surface-hover"
                        }`}
                      >
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${dc.soft}`}>
                          <ModuleIcon moduleId={m.id} className={`h-3 w-3 ${dc.text}`} />
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{m.label}</span>
                        <span className="shrink-0 text-xs text-ink-muted">
                          {MODULE_ACCENT_MAP[domainId]?.label ?? domainId}
                        </span>
                      </button>
                    ) : (
                      <span className="flex cursor-not-allowed items-center gap-2.5 px-4 py-2 text-sm text-ink-muted">
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${dc.soft}`}>
                          <ModuleIcon moduleId={m.id} className={`h-3 w-3 ${dc.text}`} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{m.label}</span>
                        <span className="shrink-0 rounded bg-canvas px-1.5 py-0.5 text-[10px]">尚未开放</span>
                      </span>
                    )}
                  </li>
                );
              })}
            </>
          )}
        </ul>
        <div className="border-t border-border px-4 py-2 text-xs text-ink-muted">
          ↑↓ 选择 · Enter 跳转 · Esc 关闭
        </div>
      </div>
    </div>
  );
}
