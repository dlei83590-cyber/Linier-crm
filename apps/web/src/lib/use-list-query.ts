"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Track A Frontend Iteration 1 — 列表查询横切 hook（reference 实现）
 *
 * 兼容两种已 FINAL 的列表 API 响应形态：
 *  A) PR 系：{ success: true, data: T[], meta: { page, pageSize, total } }
 *  B) Transfer 系：{ success: true, data: { total, page, pageSize, items: T[] } }（无 meta）
 *
 * 失败：{ success: false, error: { code, message } }（非 2xx 或 success=false 均抛错）
 */

interface ListEnvelope<T> {
  success: boolean;
  data: T[] | { total: number; page: number; pageSize: number; items: T[] };
  meta?: { page: number; pageSize: number; total: number };
  error?: { message?: string };
}

export interface ListQueryResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  refresh: () => void;
}

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
  const [error, setError] = useState<string | null>(null);
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

    fetch(`${endpoint}?${query.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          let message = `请求失败（${res.status}）`;
          try {
            const body = (await res.json()) as { error?: { message?: string } };
            message = body.error?.message ?? message;
          } catch {
            // 保留默认错误消息
          }
          throw new Error(message);
        }
        return (await res.json()) as ListEnvelope<T>;
      })
      .then((body) => {
        if (!body.success) {
          throw new Error(body.error?.message ?? "请求失败");
        }
        if (Array.isArray(body.data)) {
          setItems(body.data);
          setTotal(body.meta?.total ?? body.data.length);
        } else {
          setItems(body.data.items);
          setTotal(body.data.total);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setError(err instanceof Error ? err.message : "加载失败");
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
