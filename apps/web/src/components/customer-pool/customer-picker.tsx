"use client";

/**
 * FRT-03 — 客户公海「手工入池」客户选择器（CTO：禁手打 BusinessPartner ID）
 *
 * - 按编码/名称搜索 /api/business-partners（type=CUSTOMER 与 type=BOTH 各查一次合并，
 *   后端 isPartnerPoolEligible 只允许 CUSTOMER/BOTH 入池——选择器与后端契约一致）；
 * - 结果展示 code + name + region + 类型；选择后回填所选客户；
 * - 搜索失败展示真实错误（不伪装成空态）；输入清空即收起下拉。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { PARTNER_TYPE_LABELS } from "@/lib/customer-pool/labels";

export interface CustomerOption {
  id: string;
  code: string;
  name: string;
  region: string | null;
  type: string;
}

interface CustomerPickerProps {
  value: CustomerOption | null;
  onChange: (partner: CustomerOption | null) => void;
  disabled?: boolean;
  placeholder?: string;
}

const SEARCH_DEBOUNCE_MS = 350;

export function CustomerPicker({
  value,
  onChange,
  disabled = false,
  placeholder = "输入客户编码或名称搜索",
}: CustomerPickerProps) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const runSearch = useCallback(async (keyword: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const q = keyword.trim();
    if (!q) {
      setOptions([]);
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const encoded = encodeURIComponent(q);
      const [customers, both] = await Promise.all([
        apiFetch<CustomerOption[]>(
          `/api/business-partners?name=${encoded}&pageSize=20&type=CUSTOMER`,
          { signal: controller.signal },
        ),
        apiFetch<CustomerOption[]>(
          `/api/business-partners?name=${encoded}&pageSize=20&type=BOTH`,
          { signal: controller.signal },
        ),
      ]);
      const seen = new Set<string>();
      const merged: CustomerOption[] = [];
      for (const p of [...customers.data, ...both.data]) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          merged.push(p);
        }
      }
      setOptions(merged);
      setHasSearched(true);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof ApiClientError ? err.message : "客户搜索失败");
      setOptions([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runSearch(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, runSearch]);

  // 点击组件外部收起下拉
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const selectPartner = (p: CustomerOption) => {
    onChange(p);
    setOpen(false);
    setQuery("");
    setOptions([]);
    setHasSearched(false);
  };

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5">
        <span className="text-sm font-medium text-ink-primary">{value.name}</span>
        <span className="text-xs text-ink-muted">（{value.code}）</span>
        <span className="text-xs text-ink-muted">区域：{value.region ?? "—"}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-ink-secondary">
          {PARTNER_TYPE_LABELS[value.type] ?? value.type}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          className="ml-auto text-xs text-brand-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          更换客户
        </button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        className={INPUT_CLASS}
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-label="搜索客户（仅客户/客户兼供应商）"
        autoComplete="off"
      />
      {open ? (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface shadow-elevation-lg">
          {searching ? (
            <p className="px-3 py-2 text-sm text-ink-muted">搜索中…</p>
          ) : error ? (
            <div className="px-3 py-2">
              <p className="text-sm text-status-danger-text">客户搜索失败：{error}</p>
            </div>
          ) : options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-ink-muted">
              {hasSearched
                ? "未找到匹配客户（仅支持 CUSTOMER / BOTH 类型）"
                : "输入客户编码或名称开始搜索"}
            </p>
          ) : (
            <ul role="listbox" aria-label="客户搜索结果" className="max-h-64 overflow-y-auto">
              {options.map((p) => (
                <li key={p.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => selectPartner(p)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="text-sm font-medium text-ink-primary">{p.name}</span>
                    <span className="text-xs text-ink-muted">（{p.code}）</span>
                    <span className="text-xs text-ink-muted">区域：{p.region ?? "—"}</span>
                    <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-xs text-ink-secondary">
                      {PARTNER_TYPE_LABELS[p.type] ?? p.type}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
