"use client";

/**
 * Phase 3 MVP — Customer 360「产品」Tab（FE 2.0：三态统一 + ConfirmActionDialog + DataTable）
 *
 * 数据：GET/POST /api/business-partners/:id/products + DELETE /:id/products/:productId
 * 选品：GET /api/items（item:view 列表消费）——真实 Item selector（itemId = Item.id）
 * 权限：列表 business-partner:view；新增/删除 business-partner:edit
 * 三态：selector（loading/error/empty，禁止加载失败显示合法空列表）+ 列表（骨架/错误+重试/空态）。
 * 解除关联：window.confirm → ConfirmActionDialog（破坏性动作二次确认统一）。
 * HOLD：generic relation framework / 产品画像分析
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { ConfirmActionDialog } from "@/components/workspace";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { INPUT_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";
import { buildItemOptionViews, type ItemOptionSource } from "@/lib/frontend/supplier-options";
import { DataTable, TruncateCell, type DataTableColumn } from "./data-table";
import { IconAlertCircle, IconRefreshCw } from "./icons";

interface ProductRow {
  id: string;
  note: string | null;
  createdAt: string;
  item: { id: string; code: string; name: string; model: string | null; spec: string | null; brand: string | null };
}

export function CustomerProducts({ partnerId }: { partnerId: string }) {
  const [items, setItems] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  // 选品 options：loading/error/empty 三态（禁止 catch → setOptions([]) 伪装合法空列表）
  const [options, setOptions] = useState<ItemOptionSource[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [itemId, setItemId] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<ProductRow[]>("/api/business-partners/" + partnerId + "/products?page=1&pageSize=50")
      .then(({ data }) => setItems(data))
      .catch((err: unknown) => setError(err instanceof ApiClientError ? err.message : "加载产品失败"))
      .finally(() => setLoading(false));
  }, [partnerId]);

  const loadOptions = useCallback(() => {
    setOptionsLoading(true);
    setOptionsError(null);
    apiFetch<ItemOptionSource[]>("/api/items?pageSize=100&status=ACTIVE")
      .then(({ data }) => setOptions(Array.isArray(data) ? data : []))
      .catch((err: unknown) => setOptionsError(err instanceof ApiClientError ? err.message : "加载产品选项失败"))
      .finally(() => setOptionsLoading(false));
  }, []);

  useEffect(() => {
    load();
    loadOptions();
  }, [load, loadOptions]);

  // 已关联 item 从可选列表排除（再次关联需先解除；避免服务端 409）
  const linkedItemIds = items.map((r) => r.item.id);
  const optionViews = buildItemOptionViews(options, { alreadyLinkedItemIds: linkedItemIds });

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
      loadOptions();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const runRemove = async () => {
    if (!confirmTarget || removeBusy) return;
    setRemoveBusy(true);
    try {
      await apiFetch("/api/business-partners/" + partnerId + "/products/" + confirmTarget.id, { method: "DELETE" });
      setConfirmTarget(null);
      load();
      loadOptions();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "删除失败");
      setConfirmTarget(null);
    } finally {
      setRemoveBusy(false);
    }
  };

  const columns: DataTableColumn<ProductRow>[] = [
    { key: "code", header: "产品编码", render: (r) => (
      <LinkItem id={r.item.id} text={r.item.code} />
    ) },
    { key: "name", header: "产品名称", render: (r) => <TruncateCell text={r.item.name} /> },
    { key: "model", header: "型号", render: (r) => r.item.model ?? "—" },
    { key: "note", header: "备注", render: (r) => (r.note ? <TruncateCell text={r.note} /> : "—") },
    { key: "createdAt", header: "关联时间", render: (r) => formatDate(r.createdAt) },
    { key: "actions", header: "", render: (r) => (
      <PermissionGuard permission={actionPermission("business-partner", "edit")}>
        <button
          type="button"
          onClick={() => setConfirmTarget({ id: r.id, name: r.item.name })}
          className={BUTTON_SECONDARY_CLASS + " text-xs"}
        >
          解除
        </button>
      </PermissionGuard>
    ) },
  ];

  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-elevation-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-primary">客户产品</h2>
        {!loading && !error && <span className="text-xs text-ink-muted">共 {items.length} 个</span>}
      </div>
      {error && <p className="mb-3 text-xs text-status-danger-text">{error}</p>}

      <PermissionGuard permission={actionPermission("business-partner", "edit")}>
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-canvas/50 p-3">
          {optionsLoading ? (
            <span className="text-xs text-ink-muted">正在加载产品选项…</span>
          ) : optionsError ? (
            <span className="inline-flex items-center gap-2 text-xs text-status-danger-text">
              <IconAlertCircle className="h-3.5 w-3.5" />
              产品选项加载失败：{optionsError}
              <button type="button" onClick={loadOptions} className="inline-flex items-center gap-1 text-brand-600 underline">
                <IconRefreshCw className="h-3 w-3" />
                重试
              </button>
            </span>
          ) : optionViews.length === 0 ? (
            <span className="text-xs text-ink-muted">
              {options.length === 0 ? "暂无可用产品（物料），请先在物料工作台创建。" : "所有可选用产品均已关联，如需再次关联请先解除。"}
            </span>
          ) : (
            <>
              <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={INPUT_CLASS + " max-w-xs"}>
                <option value="">选择产品（物料）…</option>
                {optionViews.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT_CLASS + " max-w-xs"} placeholder="备注（客户料号/用途，可选）" />
              <button onClick={submit} disabled={busy} className={BUTTON_PRIMARY_CLASS + " text-xs"}>
                关联产品
              </button>
            </>
          )}
        </div>
      </PermissionGuard>

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-status-danger-border bg-status-danger-bg/30 py-8 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-status-danger-bg text-status-danger-text">
            <IconAlertCircle className="h-5 w-5" />
          </span>
          <p className="text-sm text-status-danger-text">{error}</p>
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-hover">
            <IconRefreshCw className="h-3.5 w-3.5" />
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="暂无产品关联" description="选择上方物料建立客户-产品关联，用于识别客户采购的产品。" />
      ) : (
        <DataTable columns={columns} rows={items} rowKey={(r) => r.id} />
      )}

      <ConfirmActionDialog
        open={confirmTarget !== null}
        title={"解除产品关联「" + (confirmTarget?.name ?? "") + "」？"}
        description="解除后该产品不再展示在客户产品列表；如需再次关联可重新选择。"
        confirmLabel="解除"
        tone="danger"
        busy={removeBusy}
        onConfirm={runRemove}
        onCancel={() => setConfirmTarget(null)}
      />
    </section>
  );
}

function LinkItem({ id, text }: { id: string; text: string }) {
  return (
    <Link href={"/items/" + id} className="font-medium text-brand-600 hover:underline">
      {text}
    </Link>
  );
}
