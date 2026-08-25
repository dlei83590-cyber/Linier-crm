"use client";

import { useEffect, useState } from "react";

/**
 * FE 2.0 — prefers-reduced-motion 检测 hook
 *
 * 所有装饰性动效（Tab 切换、hover 过渡等）必须在用户开启
 * prefers-reduced-motion: reduce 时禁用。本 hook 在挂载时读取
 * matchMedia，并监听变化（用户可在系统设置中切换）。
 */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    // jsdom / SSR 无 matchMedia → 视为不启用 reduced-motion（不影响测试与首屏）
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    setReduced(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
