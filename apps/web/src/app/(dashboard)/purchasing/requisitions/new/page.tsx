'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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

function RequisitionCreateForm() {
  const router = useRouter();
  const [items, setItems] = useState<ItemOption[]>([]);
  const [needDate, setNeedDate] = useState('');
  const [remark, setRemark] = useState('');
  const [lines, setLines] = useState<LineForm[]>([{ ...EMPTY_LINE }]);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 数据源：items 下拉（GET /api/items 已存在；warehouses/uom 无列表 API → 本表单只依赖 items）
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

  // Dirty state：未保存离开提示（beforeunload + 返回链接确认）
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
    // 选中 item 时自动带出 stockUom 作为行 UOM（契约内字段；服务端仍为准）
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
      const body = await apiFetch<{ id: string; code: string }>('/api/purchase-requisitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setDirty(false);
      // Success refresh：使用服务端返回事实（created.id）导航到详情（权威 re-GET）
      router.push(`/purchasing/requisitions/${body.data.id}`);
    } catch (err: unknown) {
      setError(
        err instanceof ApiClientError ? err : new ApiClientError(0, '创建失败', 'NETWORK_ERROR'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h1 className="text-lg font-semibold text-slate-800">新建采购申请</h1>
        <Link
          href="/purchasing/requisitions"
          onClick={(e) => {
            if (dirty && !window.confirm('有未保存的更改，确定离开？')) e.preventDefault();
          }}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          返回列表
        </Link>
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            <p>
              {describeStatus(error.status)}：{error.message}
              {error.code ? `（${error.code}）` : ''}
            </p>
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-4 text-sm md:grid-cols-3">
          <div>
            <label className="block text-xs text-slate-500">期望日期（可选）</label>
            <input
              type="datetime-local"
              value={needDate}
              onChange={(e) => {
                setNeedDate(e.target.value);
                markDirty();
              }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-slate-500">备注（可选，≤1000）</label>
            <textarea
              value={remark}
              onChange={(e) => {
                setRemark(e.target.value);
                markDirty();
              }}
              rows={2}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none"
            />
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700">需求明细（至少一行）</h2>
          <button
            type="button"
            onClick={addLine}
            className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white"
          >
            + 添加行
          </button>
        </div>
        {fieldErrors.lines && <p className="mb-2 text-xs text-red-600">{fieldErrors.lines}</p>}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
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
                      className="focus:border-brand-500 w-full rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none"
                    >
                      <option value="">选择物料</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.code ?? ''} {it.name ?? ''}
                        </option>
                      ))}
                    </select>
                    {fieldErrors[`lines.${idx}.itemId`] && (
                      <p className="mt-0.5 text-xs text-red-600">
                        {fieldErrors[`lines.${idx}.itemId`]}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.description}
                      onChange={(e) => updateLine(idx, { description: e.target.value })}
                      placeholder="可选"
                      className="focus:border-brand-500 w-full rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                      className="focus:border-brand-500 w-24 rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none"
                    />
                    {fieldErrors[`lines.${idx}.quantity`] && (
                      <p className="mt-0.5 text-xs text-red-600">
                        {fieldErrors[`lines.${idx}.quantity`]}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {line.uomId
                      ? (items.find((it) => it.id === line.itemId)?.stockUom?.symbol ?? '—')
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="datetime-local"
                      value={line.needDate}
                      onChange={(e) => updateLine(idx, { needDate: e.target.value })}
                      className="focus:border-brand-500 rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.remark}
                      onChange={(e) => updateLine(idx, { remark: e.target.value })}
                      placeholder="可选"
                      className="focus:border-brand-500 w-full rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      disabled={lines.length <= 1}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
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
            {submitting ? '提交中…' : '创建（DRAFT）'}
          </button>
          {dirty && <span className="text-xs text-amber-600">有未保存的更改</span>}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission="purchase-requisition:create">
      <RequisitionCreateForm />
    </PermissionGuard>
  );
}