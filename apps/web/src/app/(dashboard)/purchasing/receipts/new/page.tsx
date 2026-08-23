"use client";

/**
 * Purchase Receipt — 新建到货收货（F2-3 Batch B1，CTO #11817）
 *
 * 来源链纪律（backend Gate 兜底）：
 * - 选择 PO → GET /api/purchase-orders/{id} → 只使用该 PO 返回的真实 lines → row 绑定 purchaseOrderLineId
 * - 同一 PO Line 在同一 Receipt 内只出现一次（由来源 lines 生成，天然唯一）
 * - 不客户端重算 remainingReceiveQty / 不靠 lineNo·itemId 当 identity；最终 Gate 由 backend
 * - WAREHOUSE fulfillment 行需 warehouse（DIRECT_PROJECT 不要求）；warehouse 为可选，backend 校验
 * - quantity > 0、rejectedOnReceiptQty ≤ quantity（UX 层校验，服务端为准）
 * - DRAFT 不产生正式 Receive 事件
 *
 * 页面消费 F2-2 Workspace：AppPage → EntityFormWorkspace → ReferenceSelector → LineEditor；
 * dirty 交 EntityFormWorkspace；权限 shared constants。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import {
  AppPage,
  EntityFormWorkspace,
  ReferenceSelector,
  LineEditor,
  type LineColumn,
  type LineRow,
} from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface PurchaseOrderOption {
  id: string;
  code: string;
  status: string;
  supplier?: { code: string | null; name: string | null } | null;
}

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
}

interface PoLineOption {
  id: string;
  lineNo: number;
  quantity: string;
  remainingReceiveQty?: string;
  item?: { id: string; code: string | null; name: string | null } | null;
  uom?: { id: string; code: string | null; symbol: string | null } | null;
}

interface ReceiptLineRow extends LineRow {
  /** 来源 identity：PO Line id（不可编辑） */
  purchaseOrderLineId: string;
  /** 来源行展示标签（只读） */
  lineLabel: string;
  quantity: string;
  visibleDamageQty: string;
  rejectedOnReceiptQty: string;
}

const inputClass = INPUT_CLASS;


function ReceiptCreateForm() {
  const router = useRouter();

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [selectorsLoading, setSelectorsLoading] = useState(true);

  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<ReceiptLineRow[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  // 数据源：PO 列表（可收货候选由 backend Gate 决定）+ warehouses（当前 main FINAL read API）
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<PurchaseOrderOption[]>("/api/purchase-orders?pageSize=100", { signal: controller.signal }),
      apiFetch<WarehouseOption[]>("/api/warehouses?pageSize=100", { signal: controller.signal }),
    ])
      .then(([poBody, whBody]) => {
        setPurchaseOrders(poBody.data);
        setWarehouses(whBody.data);
        setSelectorsLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载数据源失败", "NETWORK_ERROR"));
        setSelectorsLoading(false);
      });
    return () => controller.abort();
  }, []);

  // 选择 PO → GET authoritative PO detail → 从真实 lines 生成 Receipt lines（绑定 purchaseOrderLineId）
  const handlePurchaseOrderChange = (poId: string) => {
    setPurchaseOrderId(poId);
    setLines([]);
    if (!poId) return;
    apiFetch<{ lines?: PoLineOption[] }>(`/api/purchase-orders/${poId}`)
      .then((body) => {
        const detailLines = body.data.lines ?? [];
        setLines(
          detailLines.map((l) => ({
            id: `${l.id}-receipt-row`,
            purchaseOrderLineId: l.id,
            lineLabel: `L${l.lineNo} ${l.item?.code ?? ""} ${l.item?.name ?? ""} (${l.uom?.symbol ?? ""})`.trim(),
            // 收货数量默认 PO 行剩余可收数量（未收货时 = 采购订单数量；用户指令 2026-08-21）
            quantity: l.remainingReceiveQty ?? l.quantity ?? "",
            visibleDamageQty: "0",
            rejectedOnReceiptQty: "0",
          })),
        );
        setDirty(true);
      })
      .catch(() => {
        setLines([]);
      });
  };

  // 三层 validation（仅 UX 层；领域事实以服务端为准）
  const validate = (): string | null => {
    if (!purchaseOrderId) return "请选择采购订单";
    if (lines.length === 0) return "至少需要一行收货明细";
    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i];
      const qty = Number(l.quantity);
      if (!l.quantity || !Number.isFinite(qty) || qty <= 0) {
        return `第 ${i + 1} 行：收货数量必须 > 0`;
      }
      const rejected = Number(l.rejectedOnReceiptQty || 0);
      if (!Number.isFinite(rejected) || rejected < 0 || rejected > qty) {
        return `第 ${i + 1} 行：现场拒收数量不能超过收货数量`;
      }
      const visible = Number(l.visibleDamageQty || 0);
      if (!Number.isFinite(visible) || visible < 0) {
        return `第 ${i + 1} 行：可见损坏数量不能为负`;
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
    apiFetch<{ id: string }>("/api/purchase-receipts", {
      method: "POST",
      body: JSON.stringify({
        purchaseOrderId,
        ...(warehouseId ? { warehouseId } : {}),
        ...(remark.trim() ? { remark: remark.trim() } : {}),
        lines: lines.map((l) => ({
          purchaseOrderLineId: l.purchaseOrderLineId,
          quantity: Number(l.quantity),
          visibleDamageQty: Number(l.visibleDamageQty || 0),
          rejectedOnReceiptQty: Number(l.rejectedOnReceiptQty || 0),
        })),
      }),
    })
      .then((body) => router.push(`/purchasing/receipts/${body.data.id}`))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  const lineColumns: LineColumn<ReceiptLineRow>[] = [
    { key: "lineLabel", header: "来源行（PO）", type: "readonly" },
    { key: "quantity", header: "收货数量 *", type: "number", placeholder: "> 0" },
    { key: "visibleDamageQty", header: "可见损坏", type: "number", placeholder: "0" },
    { key: "rejectedOnReceiptQty", header: "现场拒收", type: "number", placeholder: "0" },
  ];

  return (
    <EntityFormWorkspace
      title="新建到货收货"
      description="创建到货收货单（DRAFT）"
      backHref="/purchasing/receipts"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/purchasing/receipts")}
    >
      <section className="border-border rounded-md border p-4">
        <h2 className="text-ink-primary mb-3 text-sm font-semibold">基本信息</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="采购订单" required>
            <ReferenceSelector
              value={purchaseOrderId}
              onChange={handlePurchaseOrderChange}
              options={purchaseOrders.map((po) => ({
                value: po.id,
                label: po.code,
                hint: `${po.status} · ${po.supplier?.name ?? ""}`,
              }))}
              placeholder="请选择采购订单"
              loading={selectorsLoading}
            />
          </FormField>
          <FormField label="仓库（公司仓库到货）">
            <ReferenceSelector
              value={warehouseId}
              onChange={(v) => {
                setWarehouseId(v);
                setDirty(true);
              }}
              options={warehouses.map((w) => ({ value: w.id, label: w.name, hint: w.code }))}
              placeholder="可选（DIRECT_PROJECT 不要求）"
              loading={selectorsLoading}
            />
          </FormField>
          <FormField label="备注">
            <textarea
              value={remark}
              onChange={(e) => {
                setRemark(e.target.value);
                setDirty(true);
              }}
              rows={2}
              className={inputClass}
            />
          </FormField>
        </div>
      </section>

      <LineEditor<ReceiptLineRow>
        columns={lineColumns}
        lines={lines}
        onChange={(next) => {
          setLines(next);
          setDirty(true);
        }}
        onAdd={() => ({
          id: crypto.randomUUID(),
          purchaseOrderLineId: "",
          lineLabel: "",
          quantity: "",
          visibleDamageQty: "0",
          rejectedOnReceiptQty: "0",
        })}
        addLabel="添加行"
        disableAdd
        emptyMessage="请先选择采购订单（从 PO 来源行生成）"
      />
    </EntityFormWorkspace>
  );
}

export default function Page() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("purchase-receipt", "create"));
  return (
    <PermissionGuard permission={PERMISSIONS.PURCHASE_RECEIPT_READ}>
      {canCreate ? (
        <AppPage>
          <ReceiptCreateForm />
        </AppPage>
      ) : (
        <AppPage>
          <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-secondary">
            无创建权限
          </div>
        </AppPage>
      )}
    </PermissionGuard>
  );
}