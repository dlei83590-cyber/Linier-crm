"use client";

/**
 * Price Lists — 价格表详情页（含单价明细管理：新增/编辑/删除 PriceListItem）
 * 审计：GET /api/audit-logs?entityType=priceList&entityId={id}（已有 read contract）。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import {
  AppPage,
  EntityDetailWorkspace,
  ErrorPanel,
  AuditTimeline,
  ProjectSubresourceDialog,
  ConfirmActionDialog,
  type AuditEvent,
} from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS, INPUT_CLASS, SELECT_CLASS } from "@/lib/ui-classes";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatDateOnly } from "@/lib/format";
import { FormField } from "@/components/ui/form-field";

interface PriceListItemRow {
  id: string;
  unitPrice?: string | null;
  unitPriceExclTax?: string | null;
  unitPriceInclTax?: string | null;
  taxRate?: string | null;
  taxAmount?: string | null;
  minOrderQty?: number | null;
  version: number;
  isActive: boolean;
  item?: { id: string; code: string | null; name: string | null; model: string | null } | null;
}

interface PriceListDetail {
  id: string;
  code: string;
  name: string;
  priceType?: string | null;
  status?: string | null;
  currency?: string | null;
  baseCurrency?: string | null;
  quoteCurrency?: string | null;
  priceSource?: string | null;
  freightIncluded?: boolean | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  policy?: { id: string; code: string | null; name: string | null; policyType: string | null } | null;
  versions?: Array<{ id: string; versionNo: number; effectiveFrom?: string | null; effectiveTo?: string | null }>;
  items?: PriceListItemRow[];
}

interface AuditLogRow {
  id: string;
  action: string;
  result: string;
  createdAt: string;
  actor?: { id: string; email: string | null; name: string | null } | null;
}

interface ItemOption {
  id: string;
  code: string | null;
  name: string | null;
  model: string | null;
}

const PRICE_TYPE_LABELS: Record<string, string> = {
  PURCHASE: "采购",
  SALES: "销售",
  VIP: "VIP",
  AGENT: "代理",
  ENGINEERING: "工程",
  STRATEGIC: "战略",
  REGIONAL: "区域",
  CUSTOMER: "客户",
  HISTORICAL: "历史",
};

const STATUS_TONE_MAP: Record<string, "neutral" | "success" | "danger"> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  ARCHIVED: "danger",
};

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

const inputClass = INPUT_CLASS;

function PriceListDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const toast = useToast();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canEdit = hasPermission(roles, actionPermission("price-list", "edit"));

  const [detail, setDetail] = useState<PriceListDetail | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  // 单价明细管理
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [editingItem, setEditingItem] = useState<PriceListItemRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<ApiClientError | null>(null);
  const [itemId, setItemId] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [taxRate, setTaxRate] = useState("13");
  const [minOrderQty, setMinOrderQty] = useState("");
  const [deleting, setDeleting] = useState<PriceListItemRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = () => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch<PriceListDetail>("/api/price-lists/" + id, { signal: controller.signal }),
      apiFetch<AuditLogRow[]>("/api/audit-logs?entityType=priceList&entityId=" + id + "&pageSize=20", {
        signal: controller.signal,
      }).catch(() => ({ data: [] as AuditLogRow[], success: true })),
    ])
      .then(([plBody, auditBody]) => {
        setDetail(plBody.data);
        setAudit(
          auditBody.data.map((a) => ({
            id: a.id,
            action: a.action,
            actor: a.actor?.name ?? a.actor?.email ?? null,
            at: a.createdAt,
            note: a.result,
          })),
        );
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setLoading(false);
      });
    return () => controller.abort();
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 物料选项（新增单价选择用）
  const openCreate = () => {
    setDialogMode("create");
    setEditingItem(null);
    setItemId("");
    setUnitPrice("");
    setTaxRate("13");
    setMinOrderQty("");
    setDialogError(null);
    if (itemOptions.length === 0) {
      apiFetch<ItemOption[]>("/api/items?pageSize=100")
        .then((body) => setItemOptions(body.data))
        .catch(() => undefined);
    }
    setDialogOpen(true);
  };

  const openEdit = (row: PriceListItemRow) => {
    setDialogMode("edit");
    setEditingItem(row);
    setItemId(row.item?.id ?? "");
    setUnitPrice(row.unitPriceExclTax ?? "");
    setTaxRate(row.taxRate ?? "13");
    setMinOrderQty(row.minOrderQty != null ? String(row.minOrderQty) : "");
    setDialogError(null);
    setDialogOpen(true);
  };

  const reloadItem = () => {
    if (!editingItem) return;
    apiFetch<PriceListItemRow>("/api/price-lists/" + id + "/items/" + editingItem.id)
      .then((body) => {
        const d = body.data;
        setEditingItem(d);
        setUnitPrice(d.unitPriceExclTax ?? "");
        setTaxRate(d.taxRate ?? "13");
        setMinOrderQty(d.minOrderQty != null ? String(d.minOrderQty) : "");
        setDialogError(null);
        load();
      })
      .catch(() => undefined);
  };

  const handleSaveItem = () => {
    if (saving) return;
    const price = Number(unitPrice);
    const rate = Number(taxRate);
    if (dialogMode === "create" && !itemId) {
      setDialogError(new ApiClientError(400, "请选择物料", "VALIDATION"));
      return;
    }
    if (!unitPrice || !(price > 0)) {
      setDialogError(new ApiClientError(400, "未税单价必须大于 0", "VALIDATION"));
      return;
    }
    if (isNaN(rate) || rate < 0 || rate > 100) {
      setDialogError(new ApiClientError(400, "税率必须在 0-100 之间", "VALIDATION"));
      return;
    }
    setSaving(true);
    setDialogError(null);
    const payload: Record<string, unknown> = {
      unitPriceExclTax: price,
      taxRate: rate,
      minOrderQty: minOrderQty ? Number(minOrderQty) : null,
    };
    if (dialogMode === "create") {
      payload.itemId = itemId;
      apiFetch<{ id: string }>("/api/price-lists/" + id + "/items", {
        method: "POST",
        body: JSON.stringify(payload),
      })
        .then(() => {
          toast.success("单价已新增");
          setDialogOpen(false);
          load();
        })
        .catch((err: unknown) => {
          setDialogError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
          setSaving(false);
        });
    } else if (editingItem) {
      payload.version = editingItem.version;
      apiFetch<{ id: string }>("/api/price-lists/" + id + "/items/" + editingItem.id, {
        method: "PATCH",
        body: JSON.stringify(payload),
      })
        .then(() => {
          toast.success("单价已更新");
          setDialogOpen(false);
          load();
        })
        .catch((err: unknown) => {
          setDialogError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
          setSaving(false);
        });
    }
  };

  const runDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/price-lists/" + id + "/items/" + deleting.id, { method: "DELETE" });
      toast.success("单价已删除");
      setDeleting(null);
      load();
    } catch (err) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "删除失败", "NETWORK_ERROR");
      toast.error("删除失败", e.message);
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  if (loading) {
    return (
      <AppPage>
        <div className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">
          加载中…
        </div>
      </AppPage>
    );
  }

  if (error || !detail) {
    return (
      <AppPage>
        <ErrorPanel error={error} />
        <Link href="/price-lists" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          返回列表
        </Link>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <EntityDetailWorkspace
        title={"价格表详情 — " + detail.name}
        description={"编码：" + detail.code}
        backHref="/price-lists"
        status={detail.status ?? undefined}
        statusTone={detail.status ? STATUS_TONE_MAP[detail.status] : undefined}
        actions={
          canEdit ? (
            <Link href={"/price-lists/" + id + "/edit"} className={BUTTON_PRIMARY_CLASS}>
              编辑
            </Link>
          ) : undefined
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem
              label="价格类型"
              value={detail.priceType ? PRICE_TYPE_LABELS[detail.priceType] ?? detail.priceType : null}
            />
            <InfoItem label="策略" value={detail.policy?.name ?? null} />
            <InfoItem label="含运费" value={detail.freightIncluded ? "是" : "否"} />
            <InfoItem label="生效" value={formatDateOnly(detail.effectiveFrom)} />
            <InfoItem label="失效" value={formatDateOnly(detail.effectiveTo)} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem label="更新时间" value={formatDate(detail.updatedAt)} />
          </div>
        }
        audit={
          <div>
            <h2 className="mb-3 text-sm font-semibold text-ink-primary">审计记录</h2>
            <AuditTimeline events={audit} />
          </div>
        }
      >
        <div className="space-y-4">
          <section className="rounded-md border border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-primary">
                价格条目（{detail.items?.length ?? 0}）
              </h2>
              {canEdit && (
                <button type="button" onClick={openCreate} className={BUTTON_SECONDARY_CLASS}>
                  + 新增单价
                </button>
              )}
            </div>
            {detail.items && detail.items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                    <tr>
                      <th className="px-3 py-2 font-medium">物料编码</th>
                      <th className="px-3 py-2 font-medium">物料名称</th>
                      <th className="px-3 py-2 font-medium">型号</th>
                      <th className="px-3 py-2 font-medium">未税单价</th>
                      <th className="px-3 py-2 font-medium">税率</th>
                      <th className="px-3 py-2 font-medium">含税单价</th>
                      <th className="px-3 py-2 font-medium">最小起订量</th>
                      {canEdit && <th className="px-3 py-2 font-medium">操作</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detail.items.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-2 text-ink-primary">{line.item?.code ?? "—"}</td>
                        <td className="px-3 py-2 text-ink-primary">{line.item?.name ?? "—"}</td>
                        <td className="px-3 py-2 text-ink-primary">{line.item?.model ?? "—"}</td>
                        <td className="px-3 py-2 text-ink-primary">{line.unitPriceExclTax ?? line.unitPrice ?? "—"}</td>
                        <td className="px-3 py-2 text-ink-primary">{line.taxRate ? line.taxRate + "%" : "—"}</td>
                        <td className="px-3 py-2 text-ink-primary">{line.unitPriceInclTax ?? "—"}</td>
                        <td className="px-3 py-2 text-ink-primary">{line.minOrderQty ?? "—"}</td>
                        {canEdit && (
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-1">
                              <button type="button" onClick={() => openEdit(line)} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-slate-100">
                                编辑
                              </button>
                              <button type="button" onClick={() => setDeleting(line)} className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text transition-colors hover:bg-red-50">
                                删除
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-4 text-sm text-ink-muted">暂无价格条目——点击「+ 新增单价」添加第一个单价</p>
            )}
          </section>

          {detail.versions && detail.versions.length > 0 ? (
            <section className="rounded-md border border-border p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink-primary">版本历史</h2>
              <ul className="space-y-2">
                {detail.versions.map((v) => (
                  <li key={v.id} className="flex items-baseline gap-3 text-sm">
                    <span className="font-medium text-ink-primary">v{v.versionNo}</span>
                    <span className="text-xs text-ink-muted">
                      {formatDateOnly(v.effectiveFrom)} → {formatDateOnly(v.effectiveTo)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </EntityDetailWorkspace>

      <ProjectSubresourceDialog
        open={dialogOpen}
        mode={dialogMode}
        title={dialogMode === "create" ? "新增单价" : "编辑单价"}
        saving={saving}
        error={dialogError}
        submitDisabled={dialogMode === "create" && !itemId}
        onReload={reloadItem}
        onSubmit={handleSaveItem}
        onClose={() => setDialogOpen(false)}
      >
        <div className="space-y-3">
          <FormField label="物料" required={dialogMode === "create"}>
            {dialogMode === "create" ? (
              <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={SELECT_CLASS}>
                <option value="">请选择物料</option>
                {itemOptions.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name ?? it.code}{it.model ? "（" + it.model + "）" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-ink-primary">{editingItem?.item?.name ?? editingItem?.item?.code ?? "—"}</p>
            )}
          </FormField>
          <FormField label="未税单价" required>
            <input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className={inputClass} placeholder="0.0000" />
          </FormField>
          <FormField label="税率 %">
            <input value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className={inputClass} placeholder="13" />
          </FormField>
          <FormField label="最小起订量">
            <input value={minOrderQty} onChange={(e) => setMinOrderQty(e.target.value)} className={inputClass} placeholder="可空" />
          </FormField>
        </div>
      </ProjectSubresourceDialog>

      <ConfirmActionDialog
        open={deleting !== null}
        title={"删除单价「" + (deleting?.item?.name ?? deleting?.item?.code ?? "") + "」？"}
        description="删除后该物料不再使用此价格表的单价（历史报价快照不受影响）。"
        confirmLabel="删除"
        tone="danger"
        busy={deleteBusy}
        onConfirm={runDelete}
        onCancel={() => setDeleting(null)}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("price-list", "view")}>
      <PriceListDetailPage />
    </PermissionGuard>
  );
}
