"use client";

/**
 * Phase 3 MVP — Customer 360「产品」Tab（客户 → 多产品，Migration 0051）
 *
 * 数据：GET/POST /api/business-partners/:id/products + DELETE /:id/products/:productId
 * 选品：GET /api/items（item:view 列表消费）
 * 权限：列表 business-partner:view；新增/删除 business-partner:edit
 * HOLD：generic relation framework / 产品画像分析
 */
import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";

interface ProductRow {
  id: string;
  note: string | null;
  createdAt: string;
  item: { id: string; code: string; name: string; model: string | null; spec: string | null; brand: string | null };
}

interface ItemOption {
  id: string;
  code: string;
  name: string;
  model: string | null;
}

export function CustomerProducts({ partnerId }: { partnerId: string }) {
  const [items, setItems] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [options, setOptions] = useState<ItemOption[]>([]);
  const [itemId, setItemId] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<ProductRow[]>("/api/business-partners/" + partnerId + "/products?page=1&pageSize=50")
      .then(({ data }) => setItems(data))
      .catch((err: unknown) => setError(err instanceof ApiClientError ? err.message : "加载产品失败"))
      .finally(() => setLoading(false));
  }, [partnerId]);

  useEffect(() => {
    load();
    apiFetch<ItemOption[]>("/api/items?pageSize=100&status=ACTIVE")
      .then(({ data }) => setOptions(data))
      .catch(() => setOptions([]));
  }, [load]);

  const submit = async () => {
    if (!itemId) {
      setError("请选择产品");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/business-partners/" + partnerId + "/products", {
        method: "POST",
        body: JSON.stringify({ itemId, note: note.trim() || undefined }),
      });
      setItemId("");
      setNote("");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("确认解除该产品关联？")) return;
    setError(null);
    try {
      await apiFetch("/api/business-partners/" + partnerId + "/products/" + id, { method: "DELETE" });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "删除失败");
    }
  };

  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-primary">客户产品</h2>
      {error && <p className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      <PermissionGuard permission={actionPermission("business-partner", "edit")}>
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={INPUT_CLASS + " max-w-xs"}>
            <option value="">选择产品（物料）…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} — {o.name}
                {o.model ? "（" + o.model + "）" : ""}
              </option>
            ))}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT_CLASS + " max-w-xs"} placeholder="备注（客户料号/用途，可选）" />
          <button onClick={submit} disabled={busy} className={BUTTON_PRIMARY_CLASS + " text-xs"}>
            关联产品
          </button>
        </div>
      </PermissionGuard>

      {loading ? (
        <p className="text-sm text-ink-muted">加载中…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-muted">暂无产品关联。</p>
      ) : (
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="text-ink-secondary bg-canvas text-left text-xs font-medium">
            <tr>
              <th className="px-4 py-2 font-semibold">产品编码</th>
              <th className="px-4 py-2 font-semibold">产品名称</th>
              <th className="px-4 py-2 font-semibold">型号</th>
              <th className="px-4 py-2 font-semibold">备注</th>
              <th className="px-4 py-2 font-semibold">关联时间</th>
              <th className="px-4 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2">{r.item.code}</td>
                <td className="px-4 py-2">{r.item.name}</td>
                <td className="px-4 py-2">{r.item.model ?? "—"}</td>
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
