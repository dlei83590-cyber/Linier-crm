"use client";

/**
 * Purchase Order — 编辑采购订单（F2-3 Batch A selective port，CTO #11739）
 *
 * 只吸收 PR #38 业务逻辑，不吸收旧 UI：
 * - GET detail authoritative version；仅 DRAFT 可编辑（非 DRAFT 显示「当前状态不可编辑」+ 返回详情）
 * - PATCH 携带 version；lines 全量替换；supplier/source/currency 为承诺事实锁定（schema 不可改）
 * - VERSION_CONFLICT 走 F2-2 统一 stale 面板（EntityFormWorkspace onReload：重新 GET → 更新 version → 成功后重置 dirty）
 * - 禁止 silent retry / 自动覆盖 / 自动重新 PATCH
 * - 页面消费 F2-2 Workspace：AppPage → EntityFormWorkspace → ReferenceSelector → LineEditor
 * - Dirty State 交 EntityFormWorkspace（不页面自挂 beforeunload）
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import {
  AppPage,
  EntityFormWorkspace,
  LineEditor,
  ErrorPanel,
  type LineColumn,
  type LineRow,
} from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";

interface ItemOption {
  id: string;
  code: string | null;
  name: string | null;
}

interface UomOption {
  id: string;
  code: string | null;
  name: string | null;
  symbol: string | null;
}

interface PODetail {
  id: string;
  code: string;
  sourceType?: string | null;
  status: string;
  currency?: string | null;
  expectedDeliveryDate?: string | null;
  remark?: string | null;
  version: number;
  requisition?: { id: string; code: string | null } | null;
  supplier?: { id: string; code: string | null; name: string | null } | null;
  lines?: Array<{
    id: string;
    description: string;
    quantity: string;
    unitPrice?: string | null;
    priceSource?: string | null;
    priceReason?: string | null;
    item?: { id: string; code: string | null; name: string | null } | null;
    uom?: { id: string; code: string | null; symbol: string | null } | null;
    // REQUISITION 来源行：backend PATCH gate 要求每行携带 sourcePurchaseRequisitionLineId
    sourcePurchaseRequisitionLine?: { id: string; lineNo: number; itemId: string } | null;
  }>;
}

interface POEditLineRow extends LineRow {
  itemId: string;
  description: string;
  quantity: string;
  uomId: string;
  priceSource: string;
  unitPrice: string;
  priceReason: string;
  /** REQUISITION 来源 PO：必须保留（PATCH 回传；Direct 为 null） */
  sourcePurchaseRequisitionLineId: string | null;
}

const emptyLine = (): POEditLineRow => ({
  id: crypto.randomUUID(),
  itemId: "",
  description: "",
  quantity: "",
  uomId: "",
  priceSource: "SUPPLIER_PRICE_SNAPSHOT",
  unitPrice: "",
  priceReason: "",
  sourcePurchaseRequisitionLineId: null,
});

const PRICE_SOURCE_OPTIONS = [
  { value: "SUPPLIER_PRICE_SNAPSHOT", label: "供应商价格快照" },
  { value: "MANUAL", label: "手工定价" },
];

const inputClass =
  "w-full rounded-md border border-border px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-brand-500 focus:outline-none";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-ink-secondary">
        {label}
        {required ? <span className="ml-0.5 text-status-danger-text">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function PurchaseOrderEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  const [items, setItems] = useState<ItemOption[]>([]);
  const [uoms, setUoms] = useState<UomOption[]>([]);

  const [detail, setDetail] = useState<PODetail | null>(null);
  const [notEditable, setNotEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);

  const [remark, setRemark] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [lines, setLines] = useState<POEditLineRow[]>([]);
  const [version, setVersion] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const loadDetail = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    apiFetch<PODetail>(`/api/purchase-orders/${id}`, { signal: controller.signal })
      .then((body) => {
        const d = body.data;
        setDetail(d);
        if (d.status !== "DRAFT") {
          setNotEditable(true);
          setLoading(false);
          return;
        }
        setNotEditable(false);
        setVersion(d.version);
        setRemark(d.remark ?? "");
        // type=date 需要 YYYY-MM-DD（API 返回 ISO datetime）
        setExpectedDeliveryDate(d.expectedDeliveryDate ? d.expectedDeliveryDate.slice(0, 10) : "");
        setLines(
          (d.lines ?? []).map((l) => ({
            id: l.id,
            itemId: l.item?.id ?? "",
            description: l.description ?? "",
            quantity: l.quantity ?? "",
            uomId: l.uom?.id ?? "",
            priceSource: l.priceSource === "MANUAL" ? "MANUAL" : "SUPPLIER_PRICE_SNAPSHOT",
            unitPrice: l.unitPrice ?? "",
            priceReason: l.priceReason ?? "",
            // REQUISITION 来源行：保留 source identity（PATCH 需回传）
            sourcePurchaseRequisitionLineId: l.sourcePurchaseRequisitionLine?.id ?? null,
          })),
        );
        // 重新加载最新数据后：重置 dirty（reload 成功才清）
        setDirty(false);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载失败", "NETWORK_ERROR"));
        setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  useEffect(() => loadDetail(), [loadDetail]);

  // 数据源：items / unit-of-measures（当前 main FINAL read API，统一 envelope）
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<ItemOption[]>("/api/items?pageSize=100", { signal: controller.signal }),
      apiFetch<UomOption[]>("/api/unit-of-measures?pageSize=100", { signal: controller.signal }),
    ])
      .then(([itemBody, uomBody]) => {
        setItems(itemBody.data);
        setUoms(uomBody.data);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载数据源失败", "NETWORK_ERROR"));
      });
    return () => controller.abort();
  }, []);

  // F2-2 UX Hardening ②：409 VERSION_CONFLICT 后重新加载最新数据（保持 dirty=true 直到 GET 成功）
  const handleReload = () => {
    setError(null);
    setReloadKey((k) => k + 1);
  };

  useEffect(() => {
    if (reloadKey === 0) return;
    return loadDetail();
  }, [reloadKey, loadDetail]);

  // 三层 validation（仅 UX 层；领域事实以服务端为准）
  const validate = (): string | null => {
    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i];
      if (!l.itemId) return `第 ${i + 1} 行：请选择物料`;
      const qty = Number(l.quantity);
      if (!l.quantity || !Number.isFinite(qty) || qty <= 0) return `第 ${i + 1} 行：数量必须 > 0`;
      if (l.priceSource === "MANUAL") {
        const price = Number(l.unitPrice);
        if (!l.unitPrice || !Number.isFinite(price) || price <= 0) {
          return `第 ${i + 1} 行：MANUAL 价格必须 > 0`;
        }
        if (!l.priceReason.trim()) return `第 ${i + 1} 行：MANUAL 必须填写价格依据`;
      }
    }
    return null;
  };

  const handleSave = () => {
    if (submitting) return;
    const firstError = validate();
    if (firstError) {
      setError(new ApiClientError(400, firstError, "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    apiFetch<{ id: string }>(`/api/purchase-orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        version,
        remark: remark.trim() || null,
        ...(expectedDeliveryDate ? { expectedDeliveryDate: new Date(expectedDeliveryDate).toISOString() } : { expectedDeliveryDate: null }),
        lines: lines.map((l) => ({
          itemId: l.itemId,
          ...(l.description.trim() ? { description: l.description.trim() } : {}),
          quantity: Number(l.quantity),
          ...(l.uomId ? { uomId: l.uomId } : {}),
          priceSource: l.priceSource,
          ...(l.priceSource === "MANUAL"
            ? { unitPrice: Number(l.unitPrice), priceReason: l.priceReason.trim() }
            : {}),
          // REQUISITION 来源 PO：backend PATCH gate 要求每行显式携带 source id
          ...(detail?.sourceType === "REQUISITION" && l.sourcePurchaseRequisitionLineId
            ? { sourcePurchaseRequisitionLineId: l.sourcePurchaseRequisitionLineId }
            : {}),
        })),
        changeReason: changeReason.trim(),
      }),
    })
      .then(() => router.push(`/purchasing/orders/${id}`))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  // REQUISITION 来源 PO：item 锁定（backend 要求 item == source PR Line item）+ 禁任意新增行；Direct 保持自由
  const isRequisition = detail?.sourceType === "REQUISITION";

  const lineColumns: LineColumn<POEditLineRow>[] = [
    {
      key: "itemId",
      header: "物料 *",
      type: "select",
      options: items.map((i) => ({
        value: i.id,
        label: `${i.code ?? ""} · ${i.name ?? ""}`.trim(),
      })),
      placeholder: "请选择物料",
      disabled: isRequisition,
    },
    { key: "description", header: "描述", type: "text", placeholder: "可选" },
    { key: "quantity", header: "数量 *", type: "number", placeholder: "> 0" },
    {
      key: "uomId",
      header: "单位",
      type: "select",
      options: uoms.map((u) => ({
        value: u.id,
        label: u.symbol ?? u.name ?? u.code ?? "",
      })),
      placeholder: "请选择",
    },
    {
      key: "priceSource",
      header: "价格来源",
      type: "select",
      options: PRICE_SOURCE_OPTIONS,
    },
    { key: "unitPrice", header: "手工单价", type: "number", placeholder: "MANUAL 必填" },
    { key: "priceReason", header: "价格依据", type: "text", placeholder: "MANUAL 必填" },
  ];

  if (loading) {
    return (
      <AppPage>
        <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-muted">加载中…</div>
      </AppPage>
    );
  }

  if (loadError) {
    return (
      <AppPage>
        <ErrorPanel error={loadError} />
      </AppPage>
    );
  }

  if (notEditable || !detail) {
    return (
      <AppPage>
        <div className="border-border bg-surface rounded-lg border p-6">
          <p className="text-sm font-medium text-ink-primary">当前状态不可编辑</p>
          <p className="mt-1 text-sm text-ink-secondary">
            仅 DRAFT 状态可编辑（当前状态：{detail?.status ?? "—"}）
          </p>
          <button
            type="button"
            onClick={() => router.push(`/purchasing/orders/${id}`)}
            className="bg-brand-600 hover:bg-brand-700 mt-3 rounded-md px-3 py-1.5 text-sm font-medium text-white"
          >
            返回详情
          </button>
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <EntityFormWorkspace
        title={`编辑采购订单 — ${detail.code}`}
        description={`供应商：${detail.supplier?.name ?? "—"} · 币种：${detail.currency ?? "—"}（承诺事实锁定）`}
        backHref={`/purchasing/orders/${id}`}
        mode="edit"
        submitting={submitting}
        error={error}
        dirty={dirty}
        onDirty={() => setDirty(true)}
        onReload={handleReload}
        onSave={handleSave}
        onCancel={() => router.push(`/purchasing/orders/${id}`)}
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">基本信息</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="期望交货日期">
              <input
                type="date"
                value={expectedDeliveryDate}
                onChange={(e) => {
                  setExpectedDeliveryDate(e.target.value);
                  setDirty(true);
                }}
                className={inputClass}
              />
            </Field>
            <Field label="备注">
              <textarea
                value={remark}
                onChange={(e) => {
                  setRemark(e.target.value);
                  setDirty(true);
                }}
                rows={2}
                className={inputClass}
              />
            </Field>
            <Field label="变更原因">
              <input
                value={changeReason}
                onChange={(e) => {
                  setChangeReason(e.target.value);
                  setDirty(true);
                }}
                placeholder="编辑产生 Revision，请说明变更原因"
                className={inputClass}
              />
            </Field>
          </div>
        </section>

        <LineEditor<POEditLineRow>
          columns={lineColumns}
          lines={lines}
          onChange={(next) => {
            setLines(next);
            setDirty(true);
          }}
          onAdd={emptyLine}
          addLabel="添加行"
          disableAdd={isRequisition}
        />
      </EntityFormWorkspace>
    </AppPage>
  );
}

export default function Page() {
  const { state } = useSession();
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("purchase-order", "edit"));
  return (
    <PermissionGuard permission={PERMISSIONS.PURCHASE_ORDER_READ}>
      {canEdit ? (
        <PurchaseOrderEditForm />
      ) : (
        <AppPage>
          <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-secondary">
            无编辑权限
          </div>
        </AppPage>
      )}
    </PermissionGuard>
  );
}
