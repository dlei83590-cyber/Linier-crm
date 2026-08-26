"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api-client";

/**
 * Track A Frontend Iteration 1 — 列表查询横切 hook（Reference 实现，Error Contract Hardening 后）
 * FE 2.0 UI 补齐 — URL 同步能力（opt-in）：syncUrl 开启后 page/pageSize/筛选
 * 以 replaceState 写入地址栏（不污染历史、不触发路由跳转），首屏从 URL 恢复，
 * 实现刷新/分享/后退不丢失筛选。
 *
 * 统一走 apiFetch<T>()：parse success envelope + parse structured error（status/code/message）。
 * 兼容两种已 FINAL 的列表 API 响应形态：
 *  A) PR 系：{ success: true, data: T[], meta: { page, pageSize, total } }
 *  B) Transfer 系：{ success: true, data: { total, page, pageSize, items: T[] } }（无 meta）
 *
 * CONTRACT GAP（CTO Scale-Out Gate §10）：分页 API 若声明分页却缺 total，
 * 抛出结构化 CONTRACT_GAP 错误，禁止静默降级（fallback total = items.length）。
 */

export interface ListQueryResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: ApiClientError | null;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  refresh: () => void;
}

export interface ListQueryOptions {
  /** 将 page/pageSize/筛选同步到 URL（replaceState；不污染历史）；首屏从 URL 恢复（须配合 readUrlFilterParams 初始化 filters） */
  syncUrl?: boolean;
}

type ListData<T> = T[] | { total: number; page: number; pageSize: number; items: T[] };

/** 从当前 URL 读取指定筛选 key 的初值（页面 useState 初始化用；SSR 返回空对象） */
export function readUrlFilterParams(keys: readonly string[]): Record<string, string> {
  if (typeof window === "undefined") return {};
  const sp = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = sp.get(k);
    if (v !== null && v !== "") out[k] = v;
  }
  return out;
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

/** 把 page/pageSize/筛选合并为 URL 查询串（跳过默认值与空值，保持地址栏干净） */
function buildQueryString(
  page: number,
  pageSize: number,
  defaultPageSize: number,
  filters: Record<string, string | undefined>,
): string {
  const sp = new URLSearchParams();
  if (page !== 1) sp.set("page", String(page));
  if (pageSize !== defaultPageSize) sp.set("pageSize", String(pageSize));
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") sp.set(key, value);
  }
  const q = sp.toString();
  return q ? `?${q}` : "";
}

export function useListQuery<T>(
  endpoint: string,
  filters: Record<string, string | undefined>,
  initialPageSize = 20,
  options: ListQueryOptions = {},
): ListQueryResult<T> {
  const { syncUrl = false } = options;

  const [page, setPage] = useState<number>(() =>
    syncUrl && typeof window !== "undefined"
      ? parsePositiveInt(new URLSearchParams(window.location.search).get("page"), 1)
      : 1,
  );
  const [pageSize, setPageSize] = useState<number>(() =>
    syncUrl && typeof window !== "undefined"
      ? parsePositiveInt(
          new URLSearchParams(window.location.search).get("pageSize"),
          initialPageSize,
        )
      : initialPageSize,
  );

  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // URL 同步（replaceState，不触发路由/滚动；SSR/非 syncUrl 场景跳过）
  useEffect(() => {
    if (!syncUrl || typeof window === "undefined") return;
    const q = buildQueryString(page, pageSize, initialPageSize, filters);
    const url = window.location.pathname + q;
    if (window.location.search !== q) {
      window.history.replaceState(null, "", url);
    }
  }, [syncUrl, page, pageSize, initialPageSize, filters]);

  useEffect(() => {
    void refreshKey; // 显式引用：refreshKey 仅作为手动刷新的触发信号
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    const query = new URLSearchParams();
    query.set("page", String(page));
    query.set("pageSize", String(pageSize));
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== "") {
        query.set(key, value);
      }
    }

    setLoading(true);
    setError(null);

    apiFetch<ListData<T>>(`${endpoint}?${query.toString()}`, { signal: controller.signal })
      .then((body) => {
        if (Array.isArray(body.data)) {
          // 形态 A：data[] + meta
          if (!body.meta || typeof body.meta.total !== "number") {
            throw new ApiClientError(
              500,
              "CONTRACT GAP: 分页 API 缺少 meta.total，禁止前端静默降级",
              "CONTRACT_GAP",
            );
          }
          setItems(body.data);
          setTotal(body.meta.total);
        } else {
          // 形态 B：data{items,total,...}
          if (typeof body.data.total !== "number") {
            throw new ApiClientError(
              500,
              "CONTRACT GAP: 分页 API 缺少 data.total，禁止前端静默降级",
              "CONTRACT_GAP",
            );
          }
          setItems(body.data.items);
          setTotal(body.data.total);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [endpoint, filters, page, pageSize, refreshKey]);

  return { items, total, page, pageSize, loading, error, setPage, setPageSize, refresh };
}
