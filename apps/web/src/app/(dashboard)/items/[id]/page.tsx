"use client";

/**
 * Items — 物料详情页（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（items.md）：backend detail FINAL → 实现 Detail。
 * 结构：EntityDetailWorkspace（Header Summary → Status → Actions → Sections → Audit）。
 * 审计：GET /api/audit-logs?entityType=item&entityId={id}（已有 read contract，不拼 API）。
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
  type AuditEvent,
} from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";

interface ItemDetail {
  id: string;
  code: string;
  name: string;
  mnemonic?: string | null;
  itemType?: string | null;
  sourcingType?: string | null;
  status?: string | null;
  lifecycle?: string | null;
  series?: string | null;
  model?: string | null;
  variant?: string | null;
  spec?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
  oemCode?: string | null;
  barcode?: string | null;
  drawingNo?: string | null;
  drawingVersion?: string | null;
  revision?: string | null;
  description?: string | null;
  isSalable?: boolean | null;
  isPurchasable?: boolean | null;
  isManufacturable?: boolean | null;
  version: number;
  createdAt: string;
  // 供应商与采购价（SupplierItem；详情 GET 已 include supplierItems）
  supplierItems?: Array<{
    id: string;
    supplierId: string;
    purchasePrice?: string | number | null;
    paymentTerm?: string | null;
    isPreferred: boolean;
    supplier?: { id: string; code: string | null; name: string | null } | null;
  }>;
  updatedAt: string;
  category?: { id: string; code: string | null; name: string | null } | null;
  stockUom?: { id: string; code: string | null; name: string | null; symbol: string | null } | null;
  purchaseUom?: { id: string; code: string | null; name: string | null; symbol: string | null } | null;
  salesUom?: { id: string; code: string | null; name: string | null; symbol: string | null } | null;
  revisions?: Array<{
    id: string;
    revisionNo: number;
    changeSummary?: string | null;
    createdAt: string;
  }>;
  // P-1B 产品/原料合同视图（详情 GET 已 include）
  bomFinished?: Array<{ id: string; bomNo: string; bomVersion: number; status: string; isDefault: boolean }>;
  bomComponents?: Array<{ id: string; bom?: { id: string; bomNo: string; finishedItem?: { id: string; code: string | null; name: string | null } | null } | null }>;
  costBalance?: { avgUnitCost?: string | null; onHandQty?: string | null; totalCost?: string | null } | null;
  productionOrderFinished?: Array<{ id: string; orderNo: string; productionType: string; status: string; plannedQty: string }>;
  stockProjections?: Array<{ warehouseId: string; onHandQty: string; warehouse?: { code: string | null; name: string | null } | null }>;
  partnerPrices?: Array<{ id: string; priceList?: { id: string; name: string | null } | null }>;
}

interface AuditLogRow {
  id: string;
  action: string;
  result: string;
  createdAt: string;
  actor?: { id: string; email: string | null; name: string | null } | null;
}

const SOURCING_LABELS: Record<string, string> = {
  BOUGHT: "外购（直接采购/销售）",
  SELF_MANUFACTURED: "自产（物料组合）",
  OEM_OUTSOURCED: "OEM 外协（我方供料+加工费）",
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  FINISHED_GOOD: "成品",
  RAW_MATERIAL: "原材料",
  SEMI_FINISHED: "半成品",
  PURCHASED_PART: "外购件",
  ACCESSORY: "配件",
  SERVICE: "服务",
  CONSUMABLE: "消耗品",
  ASSET: "资产",
  TOOLING: "工装",
  PACKAGING: "包装物",
};

const STATUS_TONE_MAP: Record<string, "success" | "neutral" | "warning" | "danger"> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  LOCKED: "warning",
  ARCHIVED: "danger",
};

const LIFECYCLE_LABELS: Record<string, string> = {
  DESIGN: "设计",
  TRIAL: "试制",
  MASS_PRODUCTION: "量产",
  DISCONTINUED: "停产",
  OBSOLETE: "淘汰",
};

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function ItemDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { state } = useSession();
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("item", "edit"));

  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch<ItemDetail>(`/api/items/${id}`, { signal: controller.signal }),
      apiFetch<AuditLogRow[]>(`/api/audit-logs?entityType=item&entityId=${id}&pageSize=20`, {
        signal: controller.signal,
      }).catch(() => ({ data: [] as AuditLogRow[], success: true })),
    ])
      .then(([itemBody, auditBody]) => {
        setDetail(itemBody.data);
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
  }, [id]);

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
        <Link href="/items" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          返回列表
        </Link>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <EntityDetailWorkspace
        title={`物料详情 — ${detail.name}`}
        description={`编码：${detail.code}`}
        backHref="/items"
        status={detail.status ?? undefined}
        statusTone={detail.status ? STATUS_TONE_MAP[detail.status] : undefined}
        actions={
          canEdit ? (
            <Link
              href={`/items/${id}/edit`}
              className={BUTTON_PRIMARY_CLASS}
            >
              编辑
            </Link>
          ) : undefined
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="编码" value={detail.code} />
            <InfoItem label="名称" value={detail.name} />
            <InfoItem
              label="类型"
              value={detail.itemType ? ITEM_TYPE_LABELS[detail.itemType] ?? detail.itemType : null}
            />
            <InfoItem
              label="商品来源"
              value={detail.sourcingType ? SOURCING_LABELS[detail.sourcingType] ?? detail.sourcingType : null}
            />
            <InfoItem label="分类" value={detail.category?.name ?? null} />
            <InfoItem label="品牌" value={detail.brand} />
            <InfoItem label="制造商" value={detail.manufacturer} />
            <InfoItem
              label="默认供应商"
              value={
                (() => {
                  const pref = (detail.supplierItems ?? []).find((s) => s.isPreferred) ?? (detail.supplierItems ?? [])[0];
                  return pref?.supplier ? `${pref.supplier.name ?? ""}${pref.supplier.code ? `（${pref.supplier.code}）` : ""}`.trim() : null;
                })()
              }
            />
            <InfoItem
              label="默认采购价"
              value={
                (() => {
                  const pref = (detail.supplierItems ?? []).find((s) => s.isPreferred) ?? (detail.supplierItems ?? [])[0];
                  return pref?.purchasePrice == null ? null : `¥${String(pref.purchasePrice)}`;
                })()
              }
            />
            <InfoItem
              label="默认付款条款"
              value={
                (() => {
                  const pref = (detail.supplierItems ?? []).find((s) => s.isPreferred) ?? (detail.supplierItems ?? [])[0];
                  return pref?.paymentTerm ?? null;
                })()
              }
            />
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
            <h2 className="mb-3 text-sm font-semibold text-ink-primary">计量单位</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <InfoItem label="库存单位" value={detail.stockUom?.symbol ?? detail.stockUom?.name} />
              <InfoItem label="采购单位" value={detail.purchaseUom?.symbol ?? detail.purchaseUom?.name} />
              <InfoItem label="销售单位" value={detail.salesUom?.symbol ?? detail.salesUom?.name} />
            </div>
          </section>

          <section className="rounded-md border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink-primary">状态与标记</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <p className="text-xs text-ink-muted">生命周期</p>
                <p className="mt-0.5 text-sm text-ink-primary">
                  {detail.lifecycle ? LIFECYCLE_LABELS[detail.lifecycle] ?? detail.lifecycle : "—"}
                </p>
              </div>
              <InfoItem label="可采购" value={detail.isPurchasable ? "是" : "否"} />
              <InfoItem label="可销售" value={detail.isSalable ? "是" : "否"} />
              <InfoItem label="可生产" value={detail.isManufacturable ? "是" : "否"} />
            </div>
          </section>

          {/* P-1B 产品/原料合同视图：配方 / 供应商 / 库存 / 成本 / 生产外协 / 配方使用（只读聚合，复用 Item SSOT） */}
          <section className="rounded-md border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink-primary">产品/原料合同视图</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <InfoItem
                label="商品来源"
                value={detail.sourcingType ? SOURCING_LABELS[detail.sourcingType] ?? detail.sourcingType : null}
              />
              <InfoItem
                label="移动加权单位成本"
                value={detail.costBalance?.avgUnitCost != null ? detail.costBalance.avgUnitCost : null}
              />
              <InfoItem label="库存结存数量" value={detail.costBalance?.onHandQty != null ? detail.costBalance.onHandQty : null} />
              <InfoItem label="库存结存成本" value={detail.costBalance?.totalCost != null ? detail.costBalance.totalCost : null} />
            </div>

            {(detail.bomFinished ?? []).length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-ink-muted">作为成品的配方（BOM）</p>
                <div className="flex flex-wrap gap-2">
                  {(detail.bomFinished ?? []).map((b) => (
                    <Link key={b.id} href={`/inventory/boms/${b.id}`} className="rounded-md border border-border px-2 py-1 text-xs text-brand-600 hover:bg-canvas">
                      {b.bomNo}（v{b.bomVersion}）{b.isDefault ? " · 默认" : ""} · {b.status}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {(detail.bomComponents ?? []).length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-ink-muted">作为原料被配方使用（BOM Usage）</p>
                <div className="flex flex-wrap gap-2">
                  {(detail.bomComponents ?? []).map((bc) => (
                    <Link key={bc.id} href={`/inventory/boms/${bc.bom?.id}`} className="rounded-md border border-border px-2 py-1 text-xs text-brand-600 hover:bg-canvas">
                      {bc.bom?.bomNo} → {bc.bom?.finishedItem?.code ?? ""} {bc.bom?.finishedItem?.name ?? ""}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {(detail.supplierItems ?? []).length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-ink-muted">供应商（SupplierItem）</p>
                <div className="flex flex-wrap gap-2">
                  {(detail.supplierItems ?? []).map((s) => (
                    <span key={s.id} className="rounded-md border border-border px-2 py-1 text-xs text-ink-primary">
                      {s.supplier?.name ?? s.supplier?.code ?? "—"}{s.isPreferred ? " · 优选" : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(detail.stockProjections ?? []).length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-ink-muted">库存余额（StockProjection SSOT，按仓库）</p>
                <div className="flex flex-wrap gap-2">
                  {(detail.stockProjections ?? []).map((sp, i) => (
                    <span key={sp.warehouseId + i} className="rounded-md border border-border px-2 py-1 text-xs tabular-nums text-ink-primary">
                      {sp.warehouse?.name ?? sp.warehouse?.code ?? "—"}：{sp.onHandQty}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(detail.productionOrderFinished ?? []).length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-ink-muted">生产/外协工单（作为成品产出）</p>
                <div className="flex flex-wrap gap-2">
                  {(detail.productionOrderFinished ?? []).map((po) => (
                    <Link key={po.id} href={`/inventory/production-orders/${po.id}`} className="rounded-md border border-border px-2 py-1 text-xs text-brand-600 hover:bg-canvas">
                      {po.orderNo}（{po.productionType === "OEM_OUTSOURCING" ? "OEM" : "自产"} · {po.plannedQty} · {po.status}）
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-md border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink-primary">技术属性</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <InfoItem label="系列" value={detail.series} />
              <InfoItem label="型号" value={detail.model} />
              <InfoItem label="变型" value={detail.variant} />
              <InfoItem label="规格" value={detail.spec} />
              <InfoItem label="OEM 编码" value={detail.oemCode} />
              <InfoItem label="条码" value={detail.barcode} />
              <InfoItem label="图号" value={detail.drawingNo} />
              <InfoItem label="图版" value={detail.drawingVersion} />
              <InfoItem label="版本" value={detail.revision} />
            </div>
          </section>

          {detail.description ? (
            <section className="rounded-md border border-border p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink-primary">描述</h2>
              <p className="text-sm text-ink-secondary">{detail.description}</p>
            </section>
          ) : null}

          {detail.revisions && detail.revisions.length > 0 ? (
            <section className="rounded-md border border-border p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink-primary">版本历史</h2>
              <ul className="space-y-2">
                {detail.revisions.map((r) => (
                  <li key={r.id} className="flex items-baseline gap-3 text-sm">
                    <span className="font-medium text-ink-primary">v{r.revisionNo}</span>
                    <span className="text-ink-secondary">{r.changeSummary ?? "—"}</span>
                    <span className="text-xs text-ink-muted">{formatDate(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </EntityDetailWorkspace>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("item", "view")}>
      <ItemDetailPage />
    </PermissionGuard>
  );
}