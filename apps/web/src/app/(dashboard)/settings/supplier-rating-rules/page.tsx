"use client";

/**
 * 系统设置 — 客户等级→最低供应商评级规则（cc-06 客户等级→供应商评级匹配，Contract Close）
 *
 * 专用极小配置模型 CustomerSupplierRatingRule（非 Generic Rule Engine）：
 *   客户等级（VIP/KEY/REGULAR/PROSPECT）→ 最低供应商评级（AAA..C）
 * 订单推荐供应商投影按此门槛过滤（无规则 = 不设门槛，展示全部）。
 * REGISTRY DELTA REQUIRED：本页暂无独立菜单入口（modules.ts Registry SSOT 由 CC-10 统一维护）。
 */
import { useCallback, useEffect, useState } from "react";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, ConfirmActionDialog } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { apiFetch, ApiClientError, describeStatus } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { CUSTOMER_LEVEL_LABELS, SUPPLIER_RATING_LABELS, SUPPLIER_RATINGS } from "@/lib/supplier-rating";

interface RatingRuleRow {
  id: string;
  customerLevel: string;
  minimumSupplierRating: string;
  isActive: boolean;
  version: number;
  createdAt: string;
}

const LEVEL_OPTIONS = ["VIP", "KEY", "REGULAR", "PROSPECT"] as const;

function SupplierRatingRules() {
  const toast = useToast();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canCreate = hasPermission(roles, actionPermission("customer-supplier-rating-rule", "create"));
  const canEdit = hasPermission(roles, actionPermission("customer-supplier-rating-rule", "edit"));
  const canDelete = hasPermission(roles, actionPermission("customer-supplier-rating-rule", "delete"));

  const [rows, setRows] = useState<RatingRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  // 新建表单
  const [creating, setCreating] = useState(false);
  const [newLevel, setNewLevel] = useState<string>("VIP");
  const [newRating, setNewRating] = useState<string>("A");
  const [createBusy, setCreateBusy] = useState(false);

  // 行内编辑
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRating, setEditRating] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editBusy, setEditBusy] = useState(false);

  // 删除确认
  const [deleting, setDeleting] = useState<RatingRuleRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<RatingRuleRow[]>("/api/customer-supplier-rating-rules?page=1&pageSize=100")
      .then((body) => setRows(body.data))
      .catch((err: unknown) =>
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载规则失败", "NETWORK_ERROR")),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = () => {
    if (createBusy) return;
    setCreateBusy(true);
    apiFetch<{ id: string }>("/api/customer-supplier-rating-rules", {
      method: "POST",
      body: JSON.stringify({ customerLevel: newLevel, minimumSupplierRating: newRating, isActive: true }),
    })
      .then(() => {
        toast.success("规则已创建");
        setCreating(false);
        load();
      })
      .catch((err: unknown) => {
        toast.error("创建失败", err instanceof ApiClientError ? err.message : "网络错误");
      })
      .finally(() => setCreateBusy(false));
  };

  const startEdit = (row: RatingRuleRow) => {
    setEditingId(row.id);
    setEditRating(row.minimumSupplierRating);
    setEditActive(row.isActive);
  };

  const handleSaveEdit = (row: RatingRuleRow) => {
    if (editBusy) return;
    setEditBusy(true);
    apiFetch<{ id: string }>(`/api/customer-supplier-rating-rules/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ minimumSupplierRating: editRating, isActive: editActive, version: row.version }),
    })
      .then(() => {
        toast.success("规则已保存");
        setEditingId(null);
        load();
      })
      .catch((err: unknown) => {
        toast.error("保存失败", err instanceof ApiClientError ? err.message : "网络错误");
      })
      .finally(() => setEditBusy(false));
  };

  const handleDelete = (row: RatingRuleRow) => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    apiFetch<{ id: string }>(`/api/customer-supplier-rating-rules/${row.id}`, { method: "DELETE" })
      .then(() => {
        toast.success("规则已删除");
        setDeleting(null);
        load();
      })
      .catch((err: unknown) => {
        toast.error("删除失败", err instanceof ApiClientError ? err.message : "网络错误");
      })
      .finally(() => setDeleteBusy(false));
  };

  return (
    <AppPage>
      <div className="border-border bg-surface overflow-hidden rounded-lg border">
        <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
          <div>
            <h1 className="text-ink-primary text-base font-semibold">客户等级 — 最低供应商评级</h1>
            <p className="text-ink-muted mt-0.5 text-xs">
              销售订单推荐供应商按此门槛过滤：客户等级对应最低供应商评级（PartnerCredit.rating，AAA 最高）；未配置 = 不设门槛展示全部；优选供应商优先。
            </p>
          </div>
          {canCreate && (
            <button type="button" onClick={() => setCreating((v) => !v)} className={BUTTON_PRIMARY_CLASS}>
              {creating ? "收起" : "新建规则"}
            </button>
          )}
        </div>

        {creating && (
          <div className="border-border flex flex-wrap items-end gap-3 border-b bg-canvas/40 px-5 py-4">
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              客户等级
              <select value={newLevel} onChange={(e) => setNewLevel(e.target.value)} className={SELECT_CLASS}>
                {LEVEL_OPTIONS.map((lv) => (
                  <option key={lv} value={lv}>
                    {CUSTOMER_LEVEL_LABELS[lv] ?? lv}（{lv}）
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              最低供应商评级
              <select value={newRating} onChange={(e) => setNewRating(e.target.value)} className={SELECT_CLASS}>
                {SUPPLIER_RATINGS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={handleCreate} disabled={createBusy} className={BUTTON_PRIMARY_CLASS}>
              {createBusy ? "创建中…" : "创建"}
            </button>
          </div>
        )}

        {loading ? (
          <p className="px-5 py-8 text-sm text-ink-muted">正在加载规则…</p>
        ) : error ? (
          <div role="alert" className="m-4 rounded-md border border-status-danger-border bg-status-danger-bg/10 p-3 text-sm text-status-danger-text">
            <p>
              {describeStatus(error.status)}：{error.message}
            </p>
            <button type="button" onClick={load} className="mt-2 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-canvas">
              重试
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-muted">
            暂无规则 —— 未配置任何客户等级的评级门槛，订单推荐将展示全部匹配供应商（无规则默认）。
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-ink-muted border-border border-b text-xs">
                <th className="px-5 py-2">客户等级</th>
                <th className="px-5 py-2">最低供应商评级</th>
                <th className="px-5 py-2">启用</th>
                <th className="px-5 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-5 py-2">{CUSTOMER_LEVEL_LABELS[row.customerLevel] ?? row.customerLevel}（{row.customerLevel}）</td>
                  <td className="px-5 py-2">
                    {editingId === row.id ? (
                      <select value={editRating} onChange={(e) => setEditRating(e.target.value)} className={SELECT_CLASS}>
                        {SUPPLIER_RATINGS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    ) : (
                      SUPPLIER_RATING_LABELS[row.minimumSupplierRating] ?? row.minimumSupplierRating
                    )}
                  </td>
                  <td className="px-5 py-2">
                    {editingId === row.id ? (
                      <select value={editActive ? "true" : "false"} onChange={(e) => setEditActive(e.target.value === "true")} className={SELECT_CLASS}>
                        <option value="true">是</option>
                        <option value="false">否</option>
                      </select>
                    ) : row.isActive ? (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">启用</span>
                    ) : (
                      <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-ink-secondary">停用</span>
                    )}
                  </td>
                  <td className="px-5 py-2 text-right">
                    {editingId === row.id ? (
                      <span className="inline-flex gap-2">
                        <button type="button" onClick={() => handleSaveEdit(row)} disabled={editBusy} className={BUTTON_PRIMARY_CLASS}>
                          {editBusy ? "保存中…" : "保存"}
                        </button>
                        <button type="button" onClick={() => setEditingId(null)} className={BUTTON_SECONDARY_CLASS}>
                          取消
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex gap-2">
                        {canEdit && (
                          <button type="button" onClick={() => startEdit(row)} className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-canvas">
                            编辑
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setDeleting(row)}
                            className="rounded-md border border-status-danger-border bg-surface px-2 py-1 text-xs font-medium text-status-danger-text hover:bg-status-danger-bg"
                          >
                            删除
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmActionDialog
        open={deleting !== null}
        title="删除评级规则"
        description={
          deleting
            ? `删除「${CUSTOMER_LEVEL_LABELS[deleting.customerLevel] ?? deleting.customerLevel}」的评级门槛后，该等级客户订单推荐将不再过滤（无规则默认展示全部）。确认删除？`
            : undefined
        }
        confirmLabel="确认删除"
        tone="danger"
        busy={deleteBusy}
        onConfirm={() => deleting && handleDelete(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("customer-supplier-rating-rule", "view")}>
      <SupplierRatingRules />
    </PermissionGuard>
  );
}
