'use client';

/**
 * TableDensityContext — 全局表格/页面密度（Sprint8 U5）
 *
 * - DensityProvider 挂载于 RootLayout
 * - localStorage 记忆（linier.table.density），默认 default
 * - EntityListWorkspace / AppPage 消费（组件自身 density prop 优先于全局）
 * - AdminShell 顶栏切换按钮
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type TableDensity = "default" | "compact";

const STORAGE_KEY = "linier.table.density";

interface DensityContextValue {
  density: TableDensity;
  setDensity: (d: TableDensity) => void;
}

const DensityContext = createContext<DensityContextValue | null>(null);

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<TableDensity>(() => {
    if (typeof window === "undefined") return "default";
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "compact" ? "compact" : "default";
    } catch {
      return "default";
    }
  });

  const setDensity = useCallback((d: TableDensity) => {
    setDensityState(d);
    try { window.localStorage.setItem(STORAGE_KEY, d); } catch {
      /* 隐私模式等忽略 */
    }
  }, []);

  const value = useMemo(() => ({ density, setDensity }), [density, setDensity]);

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useTableDensity(): DensityContextValue {
  const ctx = useContext(DensityContext);
  if (!ctx) {
    throw new Error("useTableDensity must be used within DensityProvider");
  }
  return ctx;
}
