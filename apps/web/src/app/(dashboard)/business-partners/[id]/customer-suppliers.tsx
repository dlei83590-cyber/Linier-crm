"use client";

/**
 * Phase 3 MVP — Customer 360「供应商」Tab（客户 → 多供应商，Migration 0051）
 *
 * 数据：GET/POST /api/business-partners/:id/suppliers + DELETE /:id/suppliers/:relationId
 * 选供应商：GET /api/suppliers（supplier:view 列表消费）
 * 权限：列表 business-partner:view；新增/删除 business-partner:edit
 * HOLD：generic relation framework / 供应商关系分析
 */
import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";

interface SupplierRow {
  id: string;
  note: string | null;
  createdAt: string;
  supplier: { id: string; code: string; name: string; type: string; uscc: string | null };
}

interface SupplierOption {
  id: string;
  code: string;
  name: string;
  partner: { id: string; name: string } | null;
}

export function CustomerSuppliers({ partnerId }: { partnerId: string }) {
  const [items, setItems] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [options, setOptions] = useState<SupplierOption[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<SupplierRow[]>("/api/business-partners/" + partnerId + "/suppliers?page=1&pageSize=50")
      .then(({ data }) => setItems(data))
      .catch((err: unknown) => setError(err instanceof ApiClientError ? err.message : "加载供应商失败"))
      .finally(() => setLoading(false));
  }, [partnerId]);

  useEffect(() => {
    load();
    apiFetch<SupplierOption[]>("/api/suppliers?pageSize=100")
      .then(({ data }) => setOptions(data))
      .catch(() => setOptions([]));
  }, [load]);

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
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={INPUT_CLASS + " max-w-xs"}>
            <option value="">选择供应商…</option>
            {options.map((o) => (
              <option key={o.id} value={o.partner?.id ?? o.id}>
                {o.code} — {o.name}
              </option>
            ))}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT_CLASS + " max-w-xs"} placeholder="备注（合作范围，可选）" />
          <button onClick={submit} disabled={busy} className={BUTTON_PRIMARY_CLASS + " text-xs"}>
            关联供应商
          </button>
        </div>
      </PermissionGuard>

      {loading ? (
        <p className="text-sm text-ink-muted">加载中…</p>
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
