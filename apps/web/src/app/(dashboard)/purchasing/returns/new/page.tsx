"use client";

/**
 * Purchase Returns — 新建采购退货（F2-3 Batch C1 Consolidation，CTO #11888 / FE 2.0 ui-08）
 *
 * 由旧式 CARD_CLASS 自绘表单迁移至统一 Workspace：
 * AppPage → EntityFormWorkspace → FormField → LineEditor。
 * - 数据源：PO 列表（GET /api/purchase-orders FINAL read API）；来源行 = 父单据详情行 ID
 * - 按单拉取退货信息：选择来源类型 → 选择来源单据（收货单按当前 PO 过滤；入库单仅 POSTED；质检全量）
 *   → 自动拉取该单据可退行供选择；服务端校验来源归属、状态与可退余额（SSOT）
 * - 每行 sourceRefType 必填、对应来源行必填、quantity > 0、returnReason 必填
 * - 服务端生成 canonical id 后导航；Dirty State 交 EntityFormWorkspace（不页面自挂 beforeunload / window.confirm）
 * - 权限用 shared constant（PERMISSIONS / actionPermission），不复制裸字符串
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import {
  AppPage,
  EntityFormWorkspace,
  LineEditor,
  type LineColumn,
  type LineRow,
} from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface PurchaseOrderOption {
  id: string;
  code: string | null;
  status: string | null;
  supplier?: { name: string | null } | null;
}

const RETURN_TYPES = ["REJECTED_ON_RECEIPT", "RETURN_AFTER_STOCK_IN", "QUALITY_ISSUE"] as const;
const SOURCE_REF_TYPES = ["RECEIPT_LINE", "WAREHOUSE_RECEIPT_LINE", "INSPECTION"] as const;
const DISPOSITIONS = ["REPLACE_REQUIRED", "CREDIT_ONLY"] as const;

interface SourceDocOption {
  id: string;
  code: string | null;
  status?: string | null;
}

interface SourceLineOption {
  id: string;
  label: string;
}

interface ReturnLineRow extends LineRow {
  sourceRefType: string;
  /** 来源单据 id（按单拉取退货信息：选择单据 → 拉取该单据可退行） */
  sourceDocId: string;
  sourceDocLines: SourceLineOption[];
  docLoading: boolean;
  sourcePurchaseReceiptLineId: string;
  sourceWarehouseReceiptLineId: string;
  sourceInspectionId: string;
  quantity: string;
  disposition: string;
  returnReason: string;
  batchNo: string;
  serialNos: string;
  remark: string;
}

const emptyLine = (): ReturnLineRow => ({
  id: crypto.randomUUID(),
  sourceRefType: "RECEIPT_LINE",
  sourceDocId: "",
  sourceDocLines: [],
  docLoading: false,
  sourcePurchaseReceiptLineId: "",
  sourceWarehouseReceiptLineId: "",
  sourceInspectionId: "",
  quantity: "",
  disposition: "REPLACE_REQUIRED",
  returnReason: "",
  batchNo: "",
  serialNos: "",
  remark: "",
});

const inputClass = INPUT_CLASS;


function PurchaseReturnCreateForm() {
  const router = useRouter();

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderOption[]>([]);
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [returnType, setReturnType] = useState("REJECTED_ON_RECEIPT");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<ReturnLineRow[]>([emptyLine()]);
  // 按单拉取：来源单据列表缓存（按 sourceRefType；RECEIPT_LINE 记录加载时的 PO 过滤，PO 变化自动重取）
  const [docMap, setDocMap] = useState<Record<string, { poId: string | null; items: SourceDocOption[] }>>({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  // 数据源：PO 下拉（GET /api/purchase-orders FINAL read API）
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<PurchaseOrderOption[] | { total: number; page: number; pageSize: number; items: PurchaseOrderOption[] }>(
      "/api/purchase-orders?pageSize=100",
      { signal: controller.signal },
    )
      .then((body) => setPurchaseOrders(Array.isArray(body.data) ? body.data : (body.data.items ?? [])))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载采购订单失败", "NETWORK_ERROR"));
      });
    return () => controller.abort();
  }, []);

  /** 按来源类型加载单据列表（按单拉取退货信息；收货单按 PO 过滤，入库/质检全量；poId 变化自动重取） */
  const loadDocs = (refType: string) => {
    const poId = purchaseOrderId || null;
    const cached = docMap[refType];
    if (cached && cached.poId === poId) return; // 已缓存（同一 PO 过滤）
    let url = "";
    if (refType === "RECEIPT_LINE") {
      url = poId
        ? `/api/purchase-receipts?pageSize=100&purchaseOrderId=${encodeURIComponent(poId)}`
        : "/api/purchase-receipts?pageSize=100";
    } else if (refType === "WAREHOUSE_RECEIPT_LINE") {
      // 已入库退货：只显示 POSTED（已过账）入库单——DRAFT/CANCELLED 不可退（核销闭环）
      url = "/api/warehouse-receipts?pageSize=100&status=POSTED";
    } else {
      url = "/api/inspections?pageSize=100";
    }
    apiFetch<SourceDocOption[] | { total: number; page: number; pageSize: number; items: SourceDocOption[] }>(url)
      .then((body) => {
        const arr = Array.isArray(body.data) ? body.data : (body.data?.items ?? []);
        setDocMap((prev) => ({ ...prev, [refType]: { poId, items: arr } }));
      })
      .catch(() => setDocMap((prev) => ({ ...prev, [refType]: { poId, items: [] } })));
  };

  // PO 变化：收货单来源单据需按新 PO 重取（避免首屏无可选项死胡同；未选 PO 不预载未过滤列表）
  useEffect(() => {
    if (purchaseOrderId) loadDocs("RECEIPT_LINE");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseOrderId]);

  /** 选择来源单据 → 拉取该单据可退行（按单拉取退货信息） */
  const loadDocLines = (idx: number, docId: string, refType: string, clearSource = false) => {
    updateLine(idx, { sourceDocId: docId, sourceDocLines: [], docLoading: true });
    if (!docId) {
      updateLine(idx, { docLoading: false });
      return;
    }
    if (refType === "RECEIPT_LINE") {
      apiFetch<{ lines?: Array<{ id: string; lineNo: number; quantity: string; returnableQty?: string; item?: { code: string | null; name: string | null } | null; uom?: { symbol: string | null } | null }> }>(
        `/api/purchase-receipts/${docId}`,
      )
        .then((body) => {
          // 核销闭环：只显示可退余额 > 0 的收货行（已退完的不再出现）
          const rows = (body.data.lines ?? [])
            .filter((l) => Number(l.returnableQty ?? l.quantity ?? 0) > 0)
            .map((l) => ({
              id: l.id,
              label: `L${l.lineNo} ${l.item?.code ?? ""} ${l.item?.name ?? ""}（可退 ${l.returnableQty ?? l.quantity ?? 0}）`.trim(),
            }));
          updateLine(idx, {
            sourceDocLines: rows,
            docLoading: false,
            ...(clearSource ? { sourcePurchaseReceiptLineId: "" } : {}),
          });
        })
        .catch(() => updateLine(idx, { sourceDocLines: [], docLoading: false }));
    } else if (refType === "WAREHOUSE_RECEIPT_LINE") {
      apiFetch<{ lines?: Array<{ id: string; lineNo: number; quantity: string; returnableQty?: string; item?: { code: string | null; name: string | null } | null; uom?: { symbol: string | null } | null }> }>(
        `/api/warehouse-receipts/${docId}`,
      )
        .then((body) => {
          // 核销闭环：只显示可退余额 > 0 的入库行（已退完的不再出现）
          const rows = (body.data.lines ?? [])
            .filter((l) => Number(l.returnableQty ?? l.quantity ?? 0) > 0)
            .map((l) => ({
              id: l.id,
              label: `L${l.lineNo} ${l.item?.code ?? ""} ${l.item?.name ?? ""}（可退 ${l.returnableQty ?? l.quantity ?? 0}）`.trim(),
            }));
          updateLine(idx, {
            sourceDocLines: rows,
            docLoading: false,
            ...(clearSource ? { sourceWarehouseReceiptLineId: "" } : {}),
          });
        })
        .catch(() => updateLine(idx, { sourceDocLines: [], docLoading: false }));
    } else {
      // INSPECTION：质检记录本身即行级候选（选中即填 sourceInspectionId）
      apiFetch<{
        result?: string;
        qualifiedQty?: string;
        returnableQty?: string;
        inspectionMode?: string;
        purchaseReceiptLine?: { lineNo: number; quantity: string; item?: { code: string | null; name: string | null } | null } | null;
      }>(`/api/inspections/${docId}`)
        .then((body) => {
          const d = body.data;
          const rows = [{
            id: docId,
            label: `质检 ${d.inspectionMode ?? ""} ${d.result ?? ""}（可退 ${d.returnableQty ?? "0"}）${d.purchaseReceiptLine?.item ? ` ${d.purchaseReceiptLine.item.code ?? ""} ${d.purchaseReceiptLine.item.name ?? ""}`.trim() : ""}`.trim(),
          }];
          updateLine(idx, {
            sourceDocLines: rows,
            docLoading: false,
            ...(clearSource ? { sourceInspectionId: "" } : {}),
          });
        })
        .catch(() => updateLine(idx, { sourceDocLines: [], docLoading: false }));
    }
  };

  const updateLine = (idx: number, patch: Partial<ReturnLineRow>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  /** 行编辑：sourceRefType 变更 → 重置来源单据/来源行选择并加载该类型单据列表 */
  const handleLinesChange = (next: ReturnLineRow[]) => {
    for (let i = 0; i < next.length; i += 1) {
      const prevRow = lines[i];
      const nextRow = next[i];
      if (!prevRow || !nextRow || prevRow.sourceRefType === nextRow.sourceRefType) continue;
      nextRow.sourceDocId = "";
      nextRow.sourceDocLines = [];
      nextRow.sourcePurchaseReceiptLineId = "";
      nextRow.sourceWarehouseReceiptLineId = "";
      nextRow.sourceInspectionId = "";
      loadDocs(nextRow.sourceRefType);
    }
    setLines(next);
    setDirty(true);
  };

  // 三层 validation（仅 UX 层；领域事实以服务端为准）
  const validate = (): string | null => {
    if (!purchaseOrderId) return "请选择采购订单";
    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i];
      if (l.sourceRefType === "RECEIPT_LINE" && !l.sourcePurchaseReceiptLineId) {
        return `第 ${i + 1} 行：RECEIPT_LINE 必须选择来源收货行`;
      } else if (l.sourceRefType === "WAREHOUSE_RECEIPT_LINE" && !l.sourceWarehouseReceiptLineId) {
        return `第 ${i + 1} 行：WAREHOUSE_RECEIPT_LINE 必须选择来源入库行`;
      } else if (l.sourceRefType === "INSPECTION" && !l.sourceInspectionId) {
        return `第 ${i + 1} 行：INSPECTION 必须选择来源质检记录`;
      }
      const qty = Number(l.quantity);
      if (!l.quantity || !Number.isFinite(qty) || qty <= 0) {
        return `第 ${i + 1} 行：数量必须大于 0`;
      }
      if (!l.returnReason.trim()) {
        return `第 ${i + 1} 行：退货原因必填`;
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
    apiFetch<{ id: string }>("/api/purchase-returns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        purchaseOrderId,
        returnType,
        ...(remark ? { remark } : {}),
        lines: lines.map((l) => {
          const base: Record<string, unknown> = {
            sourceRefType: l.sourceRefType,
            quantity: Number(l.quantity),
            disposition: l.disposition,
            returnReason: l.returnReason,
            ...(l.batchNo ? { batchNo: l.batchNo } : {}),
            ...(l.serialNos
              ? { serialNos: l.serialNos.split(/[,，\s]+/).filter(Boolean) }
              : {}),
            ...(l.remark ? { remark: l.remark } : {}),
          };
          if (l.sourceRefType === "RECEIPT_LINE") base.sourcePurchaseReceiptLineId = l.sourcePurchaseReceiptLineId;
          if (l.sourceRefType === "WAREHOUSE_RECEIPT_LINE")
            base.sourceWarehouseReceiptLineId = l.sourceWarehouseReceiptLineId;
          if (l.sourceRefType === "INSPECTION") base.sourceInspectionId = l.sourceInspectionId;
          return base;
        }),
      }),
    })
      .then((body) => {
        setDirty(false);
        router.push(`/purchasing/returns/${body.data.id}`);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "创建失败", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  const sourceLineValue = (row: ReturnLineRow): string => {
    if (row.sourceRefType === "RECEIPT_LINE") return row.sourcePurchaseReceiptLineId;
    if (row.sourceRefType === "WAREHOUSE_RECEIPT_LINE") return row.sourceWarehouseReceiptLineId;
    return row.sourceInspectionId;
  };

  const setSourceLine = (row: ReturnLineRow, value: string) => {
    const idx = lines.findIndex((l) => l.id === row.id);
    const patch: Partial<ReturnLineRow> = {};
    if (row.sourceRefType === "RECEIPT_LINE") patch.sourcePurchaseReceiptLineId = value;
    else if (row.sourceRefType === "WAREHOUSE_RECEIPT_LINE") patch.sourceWarehouseReceiptLineId = value;
    else patch.sourceInspectionId = value;
    updateLine(idx, patch);
  };

  const lineColumns: LineColumn<ReturnLineRow>[] = [
    {
      key: "sourceRefType",
      header: "来源类型",
      type: "select",
      options: SOURCE_REF_TYPES.map((t) => ({ value: t, label: t })),
    },
    {
      key: "source",
      header: "来源单据 / 来源行（按单拉取）",
      render: (row) => {
        const idx = lines.findIndex((l) => l.id === row.id);
        const docs = docMap[row.sourceRefType]?.items ?? [];
        return (
          <div className="space-y-1">
            <select
              value={row.sourceDocId}
              onChange={(e) => {
                const v = e.target.value;
                loadDocs(row.sourceRefType);
                loadDocLines(idx, v, row.sourceRefType, true);
              }}
              className={inputClass}
            >
              <option value="">选择来源单据</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code ?? "未编码"}（{d.status ?? ""}）
                </option>
              ))}
            </select>
            <select
              value={sourceLineValue(row)}
              onChange={(e) => setSourceLine(row, e.target.value)}
              className={inputClass}
            >
              <option value="">选择来源行</option>
              {row.sourceDocLines.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            {row.docLoading && <p className="text-ink-muted text-xs">加载中…</p>}
            {!row.docLoading && row.sourceDocId && row.sourceDocLines.length === 0 && (
              <p className="text-status-warning-text text-xs">
                该来源无可退余额（现场拒收/质检拒收为 0）；已入库退货请选择来源类型「入库行」
              </p>
            )}
          </div>
        );
      },
    },
    { key: "quantity", header: "数量 *", type: "number", placeholder: "> 0" },
    {
      key: "disposition",
      header: "处置",
      type: "select",
      options: DISPOSITIONS.map((d) => ({ value: d, label: d })),
    },
    { key: "returnReason", header: "退货原因 *", type: "text", placeholder: "必填" },
    { key: "batchNo", header: "批次号", type: "text", placeholder: "可选" },
    { key: "serialNos", header: "序列号（逗号分隔）", type: "text", placeholder: "可选" },
    { key: "remark", header: "备注", type: "text", placeholder: "可选" },
  ];

  return (
    <EntityFormWorkspace
      title="新建采购退货"
      description="创建采购退货（DRAFT）"
      backHref="/purchasing/returns"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/purchasing/returns")}
      saveLabel="创建（草稿）"
    >
      <section className="border-border rounded-md border p-4">
        <h2 className="text-ink-primary mb-3 text-sm font-semibold">基本信息</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="采购订单" required>
            <select
              value={purchaseOrderId}
              onChange={(e) => {
                setPurchaseOrderId(e.target.value);
                setDirty(true);
              }}
              className={inputClass}
            >
              <option value="">选择采购订单</option>
              {purchaseOrders.map((po) => (
                <option key={po.id} value={po.id}>
                  {po.code ?? "未编码"}（{po.status ?? ""}）{po.supplier?.name ? ` / ${po.supplier.name}` : ""}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="退货类型" required>
            <select
              value={returnType}
              onChange={(e) => {
                setReturnType(e.target.value);
                setDirty(true);
              }}
              className={inputClass}
            >
              {RETURN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="备注">
            <textarea
              value={remark}
              onChange={(e) => {
                setRemark(e.target.value);
                setDirty(true);
              }}
              rows={2}
              maxLength={500}
              className={inputClass}
            />
          </FormField>
        </div>
      </section>

      <LineEditor<ReturnLineRow>
        columns={lineColumns}
        lines={lines}
        onChange={handleLinesChange}
        onAdd={emptyLine}
        addLabel="添加行"
        emptyMessage="请添加至少一行退货明细"
      />

      <p className="border-border bg-canvas text-ink-secondary rounded-md border p-3 text-xs">
        按单拉取退货信息：选择来源类型 → 选择来源单据（收货单按当前采购订单过滤；入库单仅 POSTED；质检全量）→ 自动拉取该单据可退行供选择。
        服务端校验来源归属、状态与可退余额（SSOT）。
      </p>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("purchase-return", "create"));
  return (
    <PermissionGuard permission={PERMISSIONS.PURCHASE_RETURN_READ}>
      {canCreate ? (
        <AppPage>
          <PurchaseReturnCreateForm />
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