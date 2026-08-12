"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api-client";

/**
 * Track A Frontend Iteration 1 — 列表查询横切 hook（Reference 实现，Error Contract Hardening 后）
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

type ListData<T> = T[] | { total: number; page: number; pageSize: number; items: T[] };

export function useListQuery<T>(
  endpoint: string,
  filters: Record<string, string | undefined>,
  initialPageSize = 20,
): ListQueryResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

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
