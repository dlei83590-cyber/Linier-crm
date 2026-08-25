"use client";

/**
 * Customer 360 — 轻量 underline Tab 导航（FE 2.0）
 *
 * - 激活 tab：域 Accent（customer-project）下划线 + 主文本 semibold
 * - 内容切换：opacity + translateY(4px) 150ms ease-out（fast 档）
 * - prefers-reduced-motion 时禁用全部装饰动效
 * - 纯展示/受控组件（active + onChange 由页面持有），无自有业务状态
 */
import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

export interface DetailTab {
  key: string;
  label: string;
}

interface DetailTabsProps {
  tabs: DetailTab[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

export function DetailTabs({ tabs, active, onChange, className = "" }: DetailTabsProps) {
  return (
    <nav
      role="tablist"
      aria-label="客户详情"
      className={"flex flex-wrap gap-x-1 gap-y-0 border-b border-border " + className}
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => {
              if (!isActive) onChange(t.key);
            }}
            className={
              "-mb-px border-b-2 px-3 pb-2.5 pt-1.5 text-sm transition-colors duration-150 ease-out " +
              (isActive
                ? "border-domain-customer-project-600 font-semibold text-ink-primary"
                : "border-transparent text-ink-secondary hover:border-border-strong hover:text-ink-primary")
            }
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

interface TabContentProps {
  /** 用于触发重挂载（页面传 key={tab}）与 effect 依赖 */
  tab: string;
  children: React.ReactNode;
}

/**
 * TabContent — Tab 内容容器（受控：调用方 <TabContent key={tab} tab={tab}>）
 * 挂载时从 opacity-0/translateY(4px) 过渡到可见（150ms ease-out）；reduced-motion 直显。
 */
export function TabContent({ tab, children }: TabContentProps) {
  const reduced = usePrefersReducedMotion();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (reduced) {
      setVisible(true);
      return;
    }
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [reduced, tab]);

  return (
    <div
      className={
        reduced
          ? ""
          : "transition-all duration-150 ease-out " +
            (visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0")
      }
    >
      {children}
    </div>
  );
}
