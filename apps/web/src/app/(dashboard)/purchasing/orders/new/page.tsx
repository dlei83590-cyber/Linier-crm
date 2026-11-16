"use client";

/**
 * Purchase Order — 新建采购订单（F2-3 Batch A selective port，CTO #11739）
 *
 * 只吸收 PR #38 业务逻辑，不吸收旧 UI：
 * - 数据源：suppliers / items / unit-of-measures / commercial-terms（当前 main FINAL read API，统一 envelope）
 * - supplierId 必填；lines 每行 itemId 必填、quantity > 0；MANUAL 要求 unitPrice + priceReason
 * - 服务端生成 canonical id 后导航；客户端不提交总金额（金额服务端 Decimal 聚合）
 * - 页面消费 F2-2 Workspace：AppPage → EntityFormWorkspace → ReferenceSelector → LineEditor
 * - Dirty State 交 EntityFormWorkspace（不页面自挂 beforeunload）
 * - 权限用 shared constant（PERMISSIONS / actionPermission），不复制裸字符串
 *
 * 引用源取数（用户指令「新增采购单供应商为空，没有关联到往来单位」）：
 * - 每源独立取数（useReferenceOptions）：此前用单个 Promise.all 拉 4 个源，任一源失败
 *   （403/500/网络）会让供应商 + 物料 + 单位 + 付款条件一起空白；
 * - 失败必须可见并可单字段重试，禁止静默降级成空下拉；
 * - 供应商成功加载但为空 → 明确说明「供应商档案来自往来单位」并给出建档入口，
 *   不再只留一个静默空下拉（供应商档案 = type=SUPPLIER/BOTH 往来单位的 1:1 角色扩展，
 *   服务端在往来单位保存时自动建档）。
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PERMISSIONS, actionPermission } from "@nilier-crm/shared";
import { can, useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import {
  AppPage,
  EntityFormWorkspace,
  ReferenceSelector,
  ReferenceErrorNote,
  LineEditor,
  type LineColumn,
  type LineRow,
} from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useReferenceOptions, referenceErrorText } from "@/lib/use-reference-options";
import { Combobox } from "@/components/ui/combobox";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface SupplierOption {
  id: string;
  code: string | null;
  name: string | null;
  currency?: string | null;
  partner?: { id: string } | null;
}

interface ItemOption {
  id: string;
  code: string | null;
  name: string | null;
  model: string | null;
  // 商品采购信息（优选供应商行；items GET include supplierItems take 1；用户指令 2026-08-21）
  supplierItems?: Array<{
    supplierId: string;
    purchasePrice?: string | number | null;
    paymentTerm?: string | null;
    isPreferred: boolean;
  }>;
}

interface UomOption {
  id: string;
  code: string | null;
  name: string | null;
  symbol: string | null;
}

interface CommercialTermOption {
  id: string;
  code: string;
  name: string;
}

interface POItemOptionRow extends LineRow {
  itemId: string;
  description: string;
  quantity: string;
  uomId: string;
  priceSource: string;
  unitPrice: string;
  priceReason: string;
}

const emptyLine = (): POItemOptionRow => ({
  id: crypto.randomUUID(),
  itemId: "",
  description: "",
  quantity: "",
  uomId: "",
  priceSource: "SUPPLIER_PRICE_SNAPSHOT",
  unitPrice: "",
  priceReason: "",
});

/** 币种受控选择（Phase 2：币种来自系统受控列表；供应商选择后自动带出供应商默认币种） */
const CURRENCY_OPTIONS = ["CNY", "USD", "EUR", "HKD", "GBP", "JPY"] as const;

const PRICE_SOURCE_OPTIONS = [
  { value: "SUPPLIER_PRICE_SNAPSHOT", label: "供应商价格快照" },
  { value: "MANUAL", label: "手工定价" },
];

/** 引用源对应的后端权限码（403 时在字段上明确「缺哪个权限」，便于管理员授权） */
const REF_SUPPLIER_PERMISSION = "supplier:view";
const REF_ITEM_PERMISSION = "item:view";
const REF_UOM_PERMISSION = "unit-of-measure:view";
const REF_TERM_PERMISSION = "commercial-term:view";

/** 本地今日 YYYY-MM-DD（date 输入默认值；用户指令 2026-08-21：全站日期默认今天） */
function todayInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const inputClass = INPUT_CLASS;


function PurchaseOrderCreateForm() {
  const router = useRouter();

  // 引用数据源：供应商 / 物料 / 计量单位 / 付款条件——**每源独立取数**（独立 loading/error/重试）
  const supplierSource = useReferenceOptions<SupplierOption>("/api/suppliers?pageSize=100");
  const itemSource = useReferenceOptions<ItemOption>("/api/items?pageSize=100");
  const uomSource = useReferenceOptions<UomOption>("/api/unit-of-measures?pageSize=100");
  const termSource = useReferenceOptions<CommercialTermOption>("/api/commercial-terms?pageSize=100");

  const suppliers = supplierSource.data;
  const items = itemSource.data;
  const uoms = uomSource.data;
  const commercialTerms = termSource.data;

  const supplierError = referenceErrorText(supplierSource.error, REF_SUPPLIER_PERMISSION);
  const itemError = referenceErrorText(itemSource.error, REF_ITEM_PERMISSION);
  const uomError = referenceErrorText(uomSource.error, REF_UOM_PERMISSION);
  const termError = referenceErrorText(termSource.error, REF_TERM_PERMISSION);

  const [supplierId, setSupplierId] = useState("");
  const [currency, setCurrency] = useState("");
  const [paymentTerm, setPaymentTerm] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(todayInput);
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<POItemOptionRow[]>([emptyLine()]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  // 三层 validation（仅 UX 层；领域事实以服务端为准）
  const validate = (): string | null => {
    if (!supplierId) return "请选择供应商";
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

  /** 供应商选择/自动带出：币种跟随供应商默认（原有逻辑收敛为共用函数） */
  const applySupplier = (sid: string) => {
    setSupplierId(sid);
    const s = suppliers.find((it) => it.id === sid);
    if (s?.currency) setCurrency(s.currency);
  };

  /** 行编辑：选商品时自动引用商品默认采购信息（默认供应商/采购价/付款条款；用户可改） */
  const handleLinesChange = (next: POItemOptionRow[]) => {
    for (let i = 0; i < next.length; i += 1) {
      const prevRow = lines[i];
      const nextRow = next[i];
      if (!prevRow || !nextRow || prevRow.itemId === nextRow.itemId) continue;
      const item = items.find((it) => it.id === nextRow.itemId);
      if (!item) continue;
      // 商品优选供应商行（SupplierItem；items GET 已取 take 1 isPreferred desc）
      const pref = item.supplierItems?.[0];
      // ① 默认供应商：PO 头未选供应商时自动带出（SupplierItem.supplierId=BP → Supplier.partner 映射）
      if (!supplierId && pref?.supplierId) {
        const s = suppliers.find((it) => it.partner?.id === pref.supplierId);
        if (s) applySupplier(s.id);
      }
      // ② 默认采购价：行仍为快照通道且未手填时，预填 MANUAL（依据自动；用户可改回快照）
      if (pref?.purchasePrice && nextRow.priceSource === "SUPPLIER_PRICE_SNAPSHOT" && !nextRow.unitPrice) {
        nextRow.priceSource = "MANUAL";
        nextRow.unitPrice = String(pref.purchasePrice);
        nextRow.priceReason = "商品默认采购价";
      }
      // ③ 默认付款条款：PO 头未设置时自动带出
      if (!paymentTerm && pref?.paymentTerm) {
        setPaymentTerm(pref.paymentTerm);
      }
    }
    setLines(next);
    setDirty(true);
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
    apiFetch<{ id: string }>("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId,
        ...(currency.trim() ? { currency: currency.trim() } : {}),
        ...(paymentTerm ? { paymentTerm } : {}),
        ...(expectedDeliveryDate ? { expectedDeliveryDate: new Date(expectedDeliveryDate).toISOString() } : {}),
        ...(remark.trim() ? { remark: remark.trim() } : {}),
        lines: lines.map((l) => ({
          itemId: l.itemId,
          ...(l.description.trim() ? { description: l.description.trim() } : {}),
          quantity: Number(l.quantity),
          ...(l.uomId ? { uomId: l.uomId } : {}),
          priceSource: l.priceSource,
          ...(l.priceSource === "MANUAL"
            ? { unitPrice: Number(l.unitPrice), priceReason: l.priceReason.trim() }
            : {}),
        })),
      }),
    })
      .then((body) => router.push(`/purchasing/orders/${body.data.id}`))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  const lineColumns: LineColumn<POItemOptionRow>[] = [
    {
      key: "itemId",
      header: "物料 *",
      type: "select",
      options: items.map((i) => ({
        value: i.id,
        label: `${i.code ?? ""} · ${i.name ?? ""}`.trim(),
      })),
      placeholder: "请选择物料",
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

  return (
    <EntityFormWorkspace
      title="新建采购订单"
      description="创建采购订单（DRAFT）"
      backHref="/purchasing/orders"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/purchasing/orders")}
    >
      <section className="border-border rounded-md border p-4">
        <h2 className="text-ink-primary mb-3 text-sm font-semibold">基本信息</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="供应商" required>
            <ReferenceSelector
              value={supplierId}
              onChange={(v) => {
                applySupplier(v);
                setDirty(true);
              }}
              options={suppliers.map((s) => ({
                value: s.id,
                label: s.name ?? "",
                hint: s.code ?? undefined,
              }))}
              placeholder="请选择供应商"
              loading={supplierSource.loading}
              error={supplierError}
              onRetry={supplierSource.reload}
            />
            {!supplierSource.loading && !supplierSource.error && suppliers.length === 0 ? (
              <p className="text-ink-muted text-xs">
                暂无供应商档案。供应商档案来自往来单位：往来单位类型设为「供应商」或「客户/供应商」后自动建立档案；
                <Link href="/business-partners/new" className="underline underline-offset-2">
                  新建往来单位
                </Link>
                （已有往来单位重新保存一次即可补档）。
              </p>
            ) : null}
          </FormField>
          <FormField label="币种">
            <select
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                setDirty(true);
              }}
              className={inputClass}
            >
              <option value="">自动（供应商默认）</option>
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="付款条件">
            <Combobox
              value={paymentTerm || null}
              onValueChange={(v) => {
                setPaymentTerm(v ?? "");
                setDirty(true);
              }}
              options={commercialTerms.map((t) => ({
                value: t.code,
                label: `${t.code} ${t.name}`.trim(),
              }))}
              placeholder="不设置"
              clearable
            />
            <ReferenceErrorNote message={termError} onRetry={termSource.reload} />
          </FormField>
          <FormField label="期望交货日期">
            <input
              type="date"
              value={expectedDeliveryDate}
              onChange={(e) => {
                setExpectedDeliveryDate(e.target.value);
                setDirty(true);
              }}
              className={inputClass}
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

      {/* 行区域引用源失败提示（物料 / 单位各自独立重试，不影响标题区已加载的供应商） */}
      <ReferenceErrorNote message={itemError} onRetry={itemSource.reload} />
      <ReferenceErrorNote message={uomError} onRetry={uomSource.reload} />

      <LineEditor<POItemOptionRow>
        columns={lineColumns}
        lines={lines}
        onChange={handleLinesChange}
        onAdd={emptyLine}
        addLabel="添加行"
      />
    </EntityFormWorkspace>
  );
}

export default function Page() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    can(state.user, actionPermission("purchase-order", "create"));
  return (
    <PermissionGuard permission={PERMISSIONS.PURCHASE_ORDER_READ}>
      {canCreate ? (
        <AppPage>
          <PurchaseOrderCreateForm />
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
