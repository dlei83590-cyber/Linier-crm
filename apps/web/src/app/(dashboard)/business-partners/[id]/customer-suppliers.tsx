"use client";

/**
 * Phase 3 MVP — Customer 360「供应商」Tab（FE 2.0：三态统一 + ConfirmActionDialog + DataTable）
 *
 * 数据：GET/POST /api/business-partners/:id/suppliers + DELETE /:id/suppliers/:relationId
 * 选供应商：GET /api/suppliers（supplier:view 列表消费）——真实 BusinessPartner supplier selector
 * 权限：列表 business-partner:view；新增/删除 business-partner:edit
 * 三态：selector（loading/error/empty，禁止加载失败显示合法空列表）+ 列表（骨架/错误+重试/空态）。
 * 禁 raw database ID：POST.supplierId 语义 = BusinessPartner.id，
 * 选项 value 一律取 supplier.partner.id（无 partner 的 Supplier 行排除，禁止 ?? option.id 回退）。
 * 解除关联：window.confirm → ConfirmActionDialog。
 * HOLD：generic relation framework / 供应商关系分析
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
import { buildSupplierOptionViews, type SupplierOptionSource } from "@/lib/frontend/supplier-options";
import { DataTable, TruncateCell, type DataTableColumn } from "./data-table";
import { IconAlertCircle, IconRefreshCw } from "./icons";

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
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  // 选供应商 options：loading/error/empty 三态
  const [options, setOptions] = useState<SupplierOptionSource[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
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

  const runRemove = async () => {
    if (!confirmTarget || removeBusy) return;
    setRemoveBusy(true);
    try {
      await apiFetch("/api/business-partners/" + partnerId + "/suppliers/" + confirmTarget.id, { method: "DELETE" });
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

  const columns: DataTableColumn<SupplierRow>[] = [
    { key: "code", header: "供应商编码", render: (r) => (
      <Link href={"/business-partners/" + r.supplier.id} className="font-medium text-brand-600 hover:underline">
        {r.supplier.code}
      </Link>
    ) },
    { key: "name", header: "供应商名称", render: (r) => <TruncateCell text={r.supplier.name} /> },
    { key: "uscc", header: "统一社会信用代码", render: (r) => r.supplier.uscc ?? "—" },
    { key: "note", header: "备注", render: (r) => (r.note ? <TruncateCell text={r.note} /> : "—") },
    { key: "createdAt", header: "关联时间", render: (r) => formatDate(r.createdAt) },
    { key: "actions", header: "", render: (r) => (
      <PermissionGuard permission={actionPermission("business-partner", "edit")}>
        <button
          type="button"
          onClick={() => setConfirmTarget({ id: r.id, name: r.supplier.name })}
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
        <h2 className="text-sm font-semibold text-ink-primary">客户供应商</h2>
        {!loading && !error && <span className="text-xs text-ink-muted">共 {items.length} 个</span>}
      </div>
      {error && <p className="mb-3 text-xs text-status-danger-text">{error}</p>}

      <PermissionGuard permission={actionPermission("business-partner", "edit")}>
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-canvas/50 p-3">
          {optionsLoading ? (
            <span className="text-xs text-ink-muted">正在加载供应商选项…</span>
          ) : optionsError ? (
            <span className="inline-flex items-center gap-2 text-xs text-status-danger-text">
              <IconAlertCircle className="h-3.5 w-3.5" />
              供应商选项加载失败：{optionsError}
              <button type="button" onClick={loadOptions} className="inline-flex items-center gap-1 text-brand-600 underline">
                <IconRefreshCw className="h-3 w-3" />
                重试
              </button>
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
        <EmptyState title="暂无供应商关联" description="选择上方供应商建立客户-供应商合作关联。" />
      ) : (
        <DataTable columns={columns} rows={items} rowKey={(r) => r.id} />
      )}

      <ConfirmActionDialog
        open={confirmTarget !== null}
        title={"解除供应商关联「" + (confirmTarget?.name ?? "") + "」？"}
        description="解除后该供应商不再展示在客户供应商列表；如需再次关联可重新选择。"
        confirmLabel="解除"
        tone="danger"
        busy={removeBusy}
        onConfirm={runRemove}
        onCancel={() => setConfirmTarget(null)}
      />
    </section>
  );
}
