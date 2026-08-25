"use client";

/**
 * Phase 3 MVP — Customer 360「供应商」Tab（客户 → 多供应商，Migration 0051）
 *
 * 数据：GET/POST /api/business-partners/:id/suppliers + DELETE /:id/suppliers/:relationId
 * 选供应商：GET /api/suppliers（supplier:view 列表消费）——真实 BusinessPartner supplier selector
 * 权限：列表 business-partner:view；新增/删除 business-partner:edit
 * FRT-02：
 *   - 禁 raw database ID：POST.supplierId 语义 = BusinessPartner.id，
 *     选项 value 一律取 supplier.partner.id（无 partner 的 Supplier 行排除，禁止 ?? option.id 回退）；
 *   - 排除自身（后端禁自关联）与已关联供应商（避免重复 409）；
 *   - selector 三态（loading/error/empty，禁止加载失败显示合法空列表）。
 * HOLD：generic relation framework / 供应商关系分析
 */
import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";
import { buildSupplierOptionViews, type SupplierOptionSource } from "@/lib/frontend/supplier-options";

interface SupplierRow {
  id: string;
  note: string | null;
  createdAt: string;
  supplier: { id: string; code: string; name: string; type: string; uscc: string | null };
}

export function CustomerSuppliers({ partnerId }: { partnerId: string }) {
  const [items, setItems] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 选供应商 options：loading/error/empty 三态
  const [options, setOptions] = useState<SupplierOptionSource[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<SupplierRow[]>("/api/business-partners/" + partnerId + "/suppliers?page=1&pageSize=50")
      .then(({ data }) => setItems(data))
      .catch((err: unknown) => setError(err instanceof ApiClientError ? err.message : "加载供应商失败"))
      .finally(() => setLoading(false));
  }, [partnerId]);

  const loadOptions = useCallback(() => {
    setOptionsLoading(true);
    setOptionsError(null);
    apiFetch<SupplierOptionSource[]>("/api/suppliers?pageSize=100")
      .then(({ data }) => setOptions(Array.isArray(data) ? data : []))
      .catch((err: unknown) => setOptionsError(err instanceof ApiClientError ? err.message : "加载供应商选项失败"))
      .finally(() => setOptionsLoading(false));
  }, []);

  useEffect(() => {
    load();
    loadOptions();
  }, [load, loadOptions]);

  // 已关联供应商（BP id）与自身从可选列表排除；option.id = BusinessPartner.id（禁 raw Supplier.id）
  const linkedBpIds = items.map((r) => r.supplier.id);
  const optionViews = buildSupplierOptionViews(options, { excludePartnerId: partnerId, alreadyLinkedBpIds: linkedBpIds });

  const submit = async () => {
    if (!supplierId) {
      setError("请选择供应商");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/business-partners/" + partnerId + "/suppliers", {
        method: "POST",
        body: JSON.stringify({ supplierId, note: note.trim() || undefined }),
      });
      setSupplierId("");
      setNote("");
      load();
      loadOptions();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("确认解除该供应商关联？")) return;
    setError(null);
    try {
      await apiFetch("/api/business-partners/" + partnerId + "/suppliers/" + id, { method: "DELETE" });
      load();
      loadOptions();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "删除失败");
    }
  };

  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-primary">客户供应商</h2>
      {error && <p className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      <PermissionGuard permission={actionPermission("business-partner", "edit")}>
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
          {optionsLoading ? (
            <span className="text-xs text-ink-muted">正在加载供应商选项…</span>
          ) : optionsError ? (
            <span className="text-xs text-status-danger-text">
              供应商选项加载失败：{optionsError}
              <button type="button" onClick={loadOptions} className="ml-2 text-brand-600 underline">重试</button>
            </span>
          ) : optionViews.length === 0 ? (
            <span className="text-xs text-ink-muted">
              {options.length === 0 ? "暂无可用供应商（往来单位类型为供应商），请先创建供应商往来单位。" : "所有可用供应商均已关联，如需再次关联请先解除。"}
            </span>
          ) : (
            <>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={INPUT_CLASS + " max-w-xs"}>
                <option value="">选择供应商…</option>
                {optionViews.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT_CLASS + " max-w-xs"} placeholder="备注（合作范围，可选）" />
              <button onClick={submit} disabled={busy} className={BUTTON_PRIMARY_CLASS + " text-xs"}>
                关联供应商
              </button>
            </>
          )}
        </div>
      </PermissionGuard>

      {loading ? (
        <p className="text-sm text-ink-muted">加载中…</p>
      ) : error ? (
        <p className="text-sm text-status-danger-text">{error}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-muted">暂无供应商关联。</p>
      ) : (
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="text-ink-secondary bg-canvas text-left text-xs font-medium">
            <tr>
              <th className="px-4 py-2 font-semibold">供应商编码</th>
              <th className="px-4 py-2 font-semibold">供应商名称</th>
              <th className="px-4 py-2 font-semibold">统一社会信用代码</th>
              <th className="px-4 py-2 font-semibold">备注</th>
              <th className="px-4 py-2 font-semibold">关联时间</th>
              <th className="px-4 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2">{r.supplier.code}</td>
                <td className="px-4 py-2">{r.supplier.name}</td>
                <td className="px-4 py-2">{r.supplier.uscc ?? "—"}</td>
                <td className="px-4 py-2">{r.note ?? "—"}</td>
                <td className="px-4 py-2">{formatDate(r.createdAt)}</td>
                <td className="px-4 py-2 text-right">
                  <PermissionGuard permission={actionPermission("business-partner", "edit")}>
                    <button onClick={() => remove(r.id)} className={BUTTON_SECONDARY_CLASS + " text-xs"}>
                      解除
                    </button>
                  </PermissionGuard>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
