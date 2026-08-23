'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { PermissionGuard } from '@/components/guard/permission-guard';
import { apiFetch, ApiClientError, describeStatus } from '@/lib/api-client';
import { CARD_CLASS } from "@/lib/ui-classes";

interface ItemOption {
  id: string;
  code: string | null;
  name: string | null;
  stockUom?: { id: string; code: string | null; symbol: string | null } | null;
}

interface RequisitionDetail {
  id: string;
  code: string;
  status: string;
  version: number;
  needDate?: string | null;
  remark?: string | null;
  lines?: Array<{
    id: string;
    lineNo: number;
    itemId: string | null;
    description: string;
    quantity: string;
    uomId?: string | null;
    needDate?: string | null;
    remark?: string | null;
  }>;
}

interface LineForm {
  itemId: string;
  description: string;
  quantity: string;
  uomId: string;
  needDate: string;
  remark: string;
}

const EMPTY_LINE: LineForm = {
  itemId: '',
  description: '',
  quantity: '',
  uomId: '',
  needDate: '',
  remark: '',
};

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  // 用户指令 2026-08-21：全站取消分钟格式 → date（YYYY-MM-DD）
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function RequisitionEditForm() {
  const params = useParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();

  const [items, setItems] = useState<ItemOption[]>([]);
  const [detail, setDetail] = useState<RequisitionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [notEditable, setNotEditable] = useState(false);

  const [needDate, setNeedDate] = useState('');
  const [remark, setRemark] = useState('');
  const [lines, setLines] = useState<LineForm[]>([]);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 数据源：items 下拉
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<ItemOption[]>('/api/items?pageSize=100', { signal: controller.signal })
      .then((body) => setItems(body.data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(
          err instanceof ApiClientError
            ? err
            : new ApiClientError(0, '加载物料失败', 'NETWORK_ERROR'),
        );
      });
    return () => controller.abort();
  }, []);

  // 加载详情（Edit 回填 + version CAS 源）
  const loadDetail = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<RequisitionDetail>(`/api/purchase-requisitions/${id}`, { signal: controller.signal })
      .then((body) => {
        const d = body.data;
        setDetail(d);
        if (d.status !== 'DRAFT') {
          setNotEditable(true);
          return;
        }
        setNotEditable(false);
        setVersion(d.version);
        setNeedDate(toLocalInput(d.needDate));
        setRemark(d.remark ?? '');
        setLines(
          (d.lines ?? []).map((l) => ({
            itemId: l.itemId ?? '',
            description: l.description,
            quantity: l.quantity,
            uomId: l.uomId ?? '',
            needDate: toLocalInput(l.needDate),
            remark: l.remark ?? '',
          })),
        );
        setDirty(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(
          err instanceof ApiClientError ? err : new ApiClientError(0, '加载失败', 'NETWORK_ERROR'),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  useEffect(() => loadDetail(), [loadDetail]);

  // Dirty state
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const markDirty = () => setDirty(true);

  const updateLine = (idx: number, patch: Partial<LineForm>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    markDirty();
    if (patch.itemId) {
      const item = items.find((it) => it.id === patch.itemId);
      if (item?.stockUom?.id) {
        setLines((prev) =>
          prev.map((l, i) => (i === idx ? { ...l, uomId: item.stockUom?.id ?? l.uomId } : l)),
        );
      }
    }
  };

  const addLine = () => {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
    markDirty();
  };

  const removeLine = (idx: number) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
    markDirty();
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    lines.forEach((l, i) => {
      if (!l.itemId) errs[`lines.${i}.itemId`] = '请选择物料';
      if (!l.quantity || Number(l.quantity) <= 0) errs[`lines.${i}.quantity`] = '数量必须大于 0';
    });
    if (lines.length === 0) errs.lines = '至少需要一行';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        version,
        ...(needDate ? { needDate: toIso(needDate) } : {}),
        ...(remark ? { remark } : {}),
        lines: lines.map((l) => ({
          itemId: l.itemId,
          ...(l.description ? { description: l.description } : {}),
          quantity: Number(l.quantity),
          ...(l.uomId ? { uomId: l.uomId } : {}),
          ...(l.needDate ? { needDate: toIso(l.needDate) } : {}),
          ...(l.remark ? { remark: l.remark } : {}),
        })),
      };
      await apiFetch<RequisitionDetail>(`/api/purchase-requisitions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setDirty(false);
      // Success refresh：使用服务端返回事实导航到详情（权威 re-GET）
      router.push(`/purchasing/requisitions/${id}`);
    } catch (err: unknown) {
      // 409 VERSION_CONFLICT：不自动 retry、不覆盖本地事实；明确提示 + 由用户决定是否重新载入 authoritative detail
      const apiErr =
        err instanceof ApiClientError ? err : new ApiClientError(0, '保存失败', 'NETWORK_ERROR');
      setError(apiErr);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">
        加载中…
      </div>
    );
  }

  if (notEditable && detail) {
    return (
      <div className={CARD_CLASS}>
        <div className="flex items-center justify-between border-b border-border p-4">
          <h1 className="text-lg font-semibold text-ink-primary">编辑采购申请</h1>
          <Link
            href={`/purchasing/requisitions/${id}`}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-canvas"
          >
            返回详情
          </Link>
        </div>
        <div className="p-6">
          <p className="text-sm text-status-warning-text">
            仅草稿状态可编辑（当前 {detail.status}）——已提交/已转单的采购申请不可修改。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between border-b border-border p-4">
        <h1 className="text-lg font-semibold text-ink-primary">编辑采购申请</h1>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-status-warning-text">有未保存的更改</span>}
          <Link
            href={`/purchasing/requisitions/${id}`}
            onClick={(e) => {
              if (dirty && !window.confirm('有未保存的更改，确定离开？')) e.preventDefault();
            }}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-canvas"
          >
            返回详情
          </Link>
        </div>
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-4 rounded-md bg-status-danger-bg p-3 text-sm text-status-danger-text">
            <p>
              {describeStatus(error.status)}：{error.message}
              {error.code ? `（${error.code}）` : ''}
            </p>
            {error.code === 'VERSION_CONFLICT' && (
              <div className="mt-2">
                <p className="text-xs">
                  数据已被他人修改（VERSION_CONFLICT），未保存的更改可能丢失。重新载入最新数据后请重新确认修改。
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('未保存的更改将丢失，确定重新载入最新数据？')) {
                      setError(null);
                      loadDetail();
                    }
                  }}
                  className="bg-brand-600 hover:bg-brand-700 mt-2 rounded-md px-3 py-1 text-xs font-medium text-white"
                >
                  重新载入最新数据
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-canvas p-4 text-sm md:grid-cols-3">
          <div>
            <label className="block text-xs text-ink-secondary">单号</label>
            <p className="mt-1 font-medium text-ink-primary">{detail?.code}</p>
          </div>
          <div>
            <label className="block text-xs text-ink-secondary">期望日期（可选）</label>
            <input
              type="date"
              value={needDate}
              onChange={(e) => {
                setNeedDate(e.target.value);
                markDirty();
              }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-ink-secondary">备注（可选，≤1000）</label>
            <textarea
              value={remark}
              onChange={(e) => {
                setRemark(e.target.value);
                markDirty();
              }}
              rows={2}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-border px-3 py-1.5 focus:outline-none"
            />
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-secondary">需求明细（至少一行）</h2>
          <button
            type="button"
            onClick={addLine}
            className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white"
          >
            + 添加行
          </button>
        </div>
        {fieldErrors.lines && <p className="mb-2 text-xs text-status-danger-text">{fieldErrors.lines}</p>}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
              <tr>
                <th className="px-3 py-2">物料</th>
                <th className="px-3 py-2">需求描述</th>
                <th className="px-3 py-2">数量</th>
                <th className="px-3 py-2">单位</th>
                <th className="px-3 py-2">需求日期</th>
                <th className="px-3 py-2">备注</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td className="px-3 py-2">
                    <select
                      value={line.itemId}
                      onChange={(e) => updateLine(idx, { itemId: e.target.value })}
                      className="focus:border-brand-500 w-full rounded-md border border-border px-2 py-1.5 focus:outline-none"
                    >
                      <option value="">选择物料</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.code ?? ''} {it.name ?? ''}
                        </option>
                      ))}
                    </select>
                    {fieldErrors[`lines.${idx}.itemId`] && (
                      <p className="mt-0.5 text-xs text-status-danger-text">
                        {fieldErrors[`lines.${idx}.itemId`]}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.description}
                      onChange={(e) => updateLine(idx, { description: e.target.value })}
                      placeholder="可选"
                      className="focus:border-brand-500 w-full rounded-md border border-border px-2 py-1.5 focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                      className="focus:border-brand-500 w-24 rounded-md border border-border px-2 py-1.5 focus:outline-none"
                    />
                    {fieldErrors[`lines.${idx}.quantity`] && (
                      <p className="mt-0.5 text-xs text-status-danger-text">
                        {fieldErrors[`lines.${idx}.quantity`]}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-secondary">
                    {line.uomId
                      ? (items.find((it) => it.id === line.itemId)?.stockUom?.symbol ?? '—')
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="date"
                      value={line.needDate}
                      onChange={(e) => updateLine(idx, { needDate: e.target.value })}
                      className="focus:border-brand-500 rounded-md border border-border px-2 py-1.5 focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.remark}
                      onChange={(e) => updateLine(idx, { remark: e.target.value })}
                      placeholder="可选"
                      className="focus:border-brand-500 w-full rounded-md border border-border px-2 py-1.5 focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      disabled={lines.length <= 1}
                      className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? '保存中…' : '保存（DRAFT）'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission="purchase-requisition:edit">
      <RequisitionEditForm />
    </PermissionGuard>
  );
}