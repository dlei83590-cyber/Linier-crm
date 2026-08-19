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
  uomId: string;
  quantity: string;
  batchNo: string;
  serialNos: string;
  mfgDate: string;
  expDate: string;
  remark: string;
}

const EMPTY_LINE: LineForm = {
  itemId: '',
  uomId: '',
  quantity: '',
  batchNo: '',
  serialNos: '',
  mfgDate: '',
  expDate: '',
  remark: '',
};

function TransferCreateForm() {
  const router = useRouter();
  const [items, setItems] = useState<ItemOption[]>([]);
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [remark, setRemark] = useState('');
  const [lines, setLines] = useState<LineForm[]>([{ ...EMPTY_LINE }]);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 数据源：items 下拉（GET /api/items 已存在；warehouses/warehouse-locations 无列表 API → CONTRACT GAP，暂以 ID 文本输入）
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
    if (!sourceWarehouseId.trim()) errs.sourceWarehouseId = '源仓库 ID 必填';
    if (!destinationWarehouseId.trim()) errs.destinationWarehouseId = '目标仓库 ID 必填';
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
        sourceWarehouseId: sourceWarehouseId.trim(),
        ...(sourceLocationId.trim() ? { sourceLocationId: sourceLocationId.trim() } : {}),
        destinationWarehouseId: destinationWarehouseId.trim(),
        ...(destinationLocationId.trim()
          ? { destinationLocationId: destinationLocationId.trim() }
          : {}),
        ...(remark ? { remark } : {}),
        lines: lines.map((l) => ({
          itemId: l.itemId,
          ...(l.uomId ? { uomId: l.uomId } : {}),
          quantity: Number(l.quantity),
          ...(l.batchNo ? { batchNo: l.batchNo } : {}),
          ...(l.serialNos.trim()
            ? {
                serialNos: l.serialNos
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              }
            : {}),
          ...(l.mfgDate ? { mfgDate: l.mfgDate } : {}),
          ...(l.expDate ? { expDate: l.expDate } : {}),
          ...(l.remark ? { remark: l.remark } : {}),
        })),
      };
      const body = await apiFetch<{ transfer: { id: string } }>('/api/inventory-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setDirty(false);
      // Success refresh：使用服务端返回事实导航到详情（权威 re-GET）
      router.push(`/inventory/transfers/${body.data.transfer.id}`);
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
        <h1 className="text-lg font-semibold text-slate-800">新建库存调拨</h1>
        <Link
          href="/inventory/transfers"
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

        <div className="mb-4 grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-4 text-sm md:grid-cols-4">
          <div>
            <label className="block text-xs text-slate-500">源仓库 ID（必填）</label>
            <input
              value={sourceWarehouseId}
              onChange={(e) => {
                setSourceWarehouseId(e.target.value);
                markDirty();
              }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none"
            />
            {fieldErrors.sourceWarehouseId && (
              <p className="mt-0.5 text-xs text-red-600">{fieldErrors.sourceWarehouseId}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-slate-500">源库位 ID（可选）</label>
            <input
              value={sourceLocationId}
              onChange={(e) => {
                setSourceLocationId(e.target.value);
                markDirty();
              }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500">目标仓库 ID（必填）</label>
            <input
              value={destinationWarehouseId}
              onChange={(e) => {
                setDestinationWarehouseId(e.target.value);
                markDirty();
              }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none"
            />
            {fieldErrors.destinationWarehouseId && (
              <p className="mt-0.5 text-xs text-red-600">{fieldErrors.destinationWarehouseId}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-slate-500">目标库位 ID（可选）</label>
            <input
              value={destinationLocationId}
              onChange={(e) => {
                setDestinationLocationId(e.target.value);
                markDirty();
              }}
              className="focus:border-brand-500 mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-slate-500">备注（可选，≤500）</label>
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
          <div className="col-span-2">
            <p className="text-xs text-amber-600">
              CONTRACT GAP：main 当前无 warehouse / warehouse-location 列表 API（仅 items 有
              GET），仓库/库位暂以 ID 文本输入；服务端仍校验存在性与组合归属。
            </p>
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700">调拨明细（至少一行）</h2>
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
                <th className="px-3 py-2">数量</th>
                <th className="px-3 py-2">单位</th>
                <th className="px-3 py-2">批次</th>
                <th className="px-3 py-2">序列号（逗号分隔）</th>
                <th className="px-3 py-2">生产日期</th>
                <th className="px-3 py-2">有效期至</th>
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
                      value={line.batchNo}
                      onChange={(e) => updateLine(idx, { batchNo: e.target.value })}
                      placeholder="可选"
                      className="focus:border-brand-500 w-full rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.serialNos}
                      onChange={(e) => updateLine(idx, { serialNos: e.target.value })}
                      placeholder="SN1,SN2"
                      className="focus:border-brand-500 w-full rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="date"
                      value={line.mfgDate}
                      onChange={(e) => updateLine(idx, { mfgDate: e.target.value })}
                      className="focus:border-brand-500 rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="date"
                      value={line.expDate}
                      onChange={(e) => updateLine(idx, { expDate: e.target.value })}
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
    <PermissionGuard permission="inventory-transfer:create">
      <TransferCreateForm />
    </PermissionGuard>
  );
}