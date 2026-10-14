"use client";

/**
 * Items — 编辑物料（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（items.md）：backend edit FINAL（PATCH + version CAS）→ 实现 Edit。
 * CAS：表单携带详情返回的 version，409 冲突时提示刷新重试（ErrorPanel 统一呈现）。
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace, ReferenceSelector, ReferenceErrorNote, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useReferenceOptions, referenceErrorText } from "@/lib/use-reference-options";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";

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

interface CommercialTermOption {
  id: string;
  code: string;
  name: string;
}

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
  spec?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
  oemCode?: string | null;
  precisionGrade?: string | null;
  preload?: string | null;
  description?: string | null;
  isSalable?: boolean | null;
  isPurchasable?: boolean | null;
  isManufacturable?: boolean | null;
  stockUomId?: string | null;
  purchaseUomId?: string | null;
  salesUomId?: string | null;
  categoryId?: string | null;
  version: number;
  // 供应商与采购价（SupplierItem；详情 GET 已 include supplierItems）
  supplierItems?: Array<{
    id: string;
    version: number;
    supplierId: string;
    purchasePrice?: string | number | null;
    paymentTerm?: string | null;
    isPreferred: boolean;
    supplier?: { id: string; code: string | null; name: string | null } | null;
  }>;
}

const ITEM_TYPE_OPTIONS = [
  { value: "FINISHED_GOOD", label: "成品" },
  { value: "RAW_MATERIAL", label: "原材料" },
  { value: "SEMI_FINISHED", label: "半成品" },
  { value: "PURCHASED_PART", label: "外购件" },
  { value: "ACCESSORY", label: "配件" },
  { value: "SERVICE", label: "服务" },
  { value: "CONSUMABLE", label: "消耗品" },
  { value: "ASSET", label: "资产" },
  { value: "TOOLING", label: "工装" },
  { value: "PACKAGING", label: "包装物" },
];

const SOURCING_OPTIONS = [
  { value: "BOUGHT", label: "外购（直接采购/销售）" },
  { value: "SELF_MANUFACTURED", label: "自产（物料组合，本厂加工）" },
  { value: "OEM_OUTSOURCED", label: "OEM 外协（含工不含料：我方供料 + 加工费）" },
  { value: "OEM_OUTSOURCED_FULL", label: "OEM 外协（含工含料：外协厂包工包料）" },
];

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "启用" },
  { value: "INACTIVE", label: "停用" },
  { value: "LOCKED", label: "锁定" },
  { value: "ARCHIVED", label: "归档" },
];

const LIFECYCLE_OPTIONS = [
  { value: "DESIGN", label: "设计" },
  { value: "TRIAL", label: "试制" },
  { value: "MASS_PRODUCTION", label: "量产" },
  { value: "DISCONTINUED", label: "停产" },
  { value: "OBSOLETE", label: "淘汰" },
];

interface SupplierOption {
  id: string;
  code: string | null;
  name: string | null;
  partner?: { id: string } | null;
}

/** 商品供应商行（SupplierItem；supplierId = BusinessPartner.id；id 非空=已存在行，用于增删改 diff） */
interface SupplierRow {
  key: string;
  id: string | null;
  version: number;
  supplierId: string;
  purchasePrice: string;
  paymentTerm: string;
  isPreferred: boolean;
}

const emptySupplierRow = (): SupplierRow => ({
  key: crypto.randomUUID(),
  id: null,
  version: 0,
  supplierId: "",
  purchasePrice: "",
  paymentTerm: "",
  isPreferred: false,
});

const inputClass = INPUT_CLASS;

/** 引用源对应的后端权限码（403 时在字段上明确"缺哪个权限"，便于管理员授权） */
const REF_CATEGORY_PERMISSION = "item-category:view";
const REF_UOM_PERMISSION = "unit-of-measure:view";
const REF_SUPPLIER_PERMISSION = "supplier:view";
const REF_TERM_PERMISSION = "commercial-term:view";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-primary">{title}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}


function ItemEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  // 引用数据源：分类 / 计量单位 / 供应商 / 付款条款——**每源独立取数**（独立 loading/error/重试）。
  // 修复 ①：此前与详情 GET 放在同一个 Promise.all，任一引用源失败会把整个编辑页打成 ErrorPanel；
  // 修复 ②：任一源失败也不再让分类 + 库存/采购/销售单位 + 供应商整组下拉空白。
  const categories = useReferenceOptions<ItemOption>("/api/item-categories?pageSize=100");
  const uoms = useReferenceOptions<UomOption>("/api/unit-of-measures?pageSize=100");
  const suppliers = useReferenceOptions<SupplierOption>("/api/suppliers?pageSize=100");
  const commercialTerms = useReferenceOptions<CommercialTermOption>("/api/commercial-terms?pageSize=100");
  const categoryError = referenceErrorText(categories.error, REF_CATEGORY_PERMISSION);
  const uomError = referenceErrorText(uoms.error, REF_UOM_PERMISSION);
  const supplierError = referenceErrorText(suppliers.error, REF_SUPPLIER_PERMISSION);
  const termError = referenceErrorText(commercialTerms.error, REF_TERM_PERMISSION);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [itemType, setItemType] = useState("");
  const [sourcingType, setSourcingType] = useState("BOUGHT");
  const [categoryId, setCategoryId] = useState("");
  const [series, setSeries] = useState("");
  const [model, setModel] = useState("");
  const [spec, setSpec] = useState("");
  const [brand, setBrand] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [oemCode, setOemCode] = useState("");
  const [precisionGrade, setPrecisionGrade] = useState("");
  const [preload, setPreload] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [stockUomId, setStockUomId] = useState("");
  const [purchaseUomId, setPurchaseUomId] = useState("");
  const [salesUomId, setSalesUomId] = useState("");
  const [isSalable, setIsSalable] = useState(true);
  const [isPurchasable, setIsPurchasable] = useState(true);
  const [isManufacturable, setIsManufacturable] = useState(false);
  const [description, setDescription] = useState("");
  // 供应商与采购价（用户指令 2026-08-21：SupplierItem 存储，ADR-0012 §9 多供应商）
  const [supplierRows, setSupplierRows] = useState<SupplierRow[]>([]);
  const [originalSupplierItems, setOriginalSupplierItems] = useState<Array<{ id: string; version: number; purchasePrice?: string | number | null; paymentTerm?: string | null; isPreferred: boolean }>>([]);
  const [version, setVersion] = useState(0);
  // 采购 / 销售单位是否仍「跟随库存单位」（联动）：详情回填时按是否与库存单位一致推导
  const [purchaseFollowsStock, setPurchaseFollowsStock] = useState(true);
  const [salesFollowsStock, setSalesFollowsStock] = useState(true);

  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  // F2-2 UX Hardening ①：Dirty-State Guard（修改后离开需确认）
  const [dirty, setDirty] = useState(false);
  // F2-2 UX Hardening ②：409 CAS 后重新加载（重新 GET → 更新 version → 重置 dirty）
  const [reloadKey, setReloadKey] = useState(0);

  // 加载详情（reloadKey 变化触发重新加载，供 409 后重取最新数据）
  // 引用源已解耦（见上方 useReferenceOptions）：详情失败才是页面级失败；引用源失败只在对应字段提示。
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<ItemDetail>(`/api/items/${id}`, { signal: controller.signal })
      .then((itemBody) => {
        const d = itemBody.data;
        setCode(d.code);
        setName(d.name);
        setMnemonic(d.mnemonic ?? "");
        setItemType(d.itemType ?? "");
        setSourcingType(d.sourcingType ?? "BOUGHT");
        setCategoryId(d.categoryId ?? "");
        setSeries(d.series ?? "");
        setModel(d.model ?? "");
        setSpec(d.spec ?? "");
        setBrand(d.brand ?? "");
        setManufacturer(d.manufacturer ?? "");
        setOemCode(d.oemCode ?? "");
        setPrecisionGrade(d.precisionGrade ?? "");
        setPreload(d.preload ?? "");
        setLifecycle(d.lifecycle ?? "");
        setStatus(d.status ?? "ACTIVE");
        setStockUomId(d.stockUomId ?? "");
        setPurchaseUomId(d.purchaseUomId ?? "");
        setSalesUomId(d.salesUomId ?? "");
        setIsSalable(d.isSalable ?? true);
        setIsPurchasable(d.isPurchasable ?? true);
        setIsManufacturable(d.isManufacturable ?? false);
        setDescription(d.description ?? "");
        // 供应商与采购价：回显 SupplierItem 行（空则给一个空行）
        const rows = (d.supplierItems ?? []).map((s) => ({
          key: s.id,
          id: s.id,
          version: s.version,
          supplierId: s.supplierId,
          purchasePrice: s.purchasePrice == null ? "" : String(s.purchasePrice),
          paymentTerm: s.paymentTerm ?? "",
          isPreferred: s.isPreferred,
        }));
        setSupplierRows(rows.length > 0 ? rows : [emptySupplierRow()]);
        setOriginalSupplierItems((d.supplierItems ?? []).map((s) => ({ id: s.id, version: s.version, purchasePrice: s.purchasePrice, paymentTerm: s.paymentTerm, isPreferred: s.isPreferred })));
        setVersion(d.version);
        // 联动初始态：详情里采购/销售单位与库存单位一致（或都为空）→ 保持「跟随库存单位」；
        // 已单独设置过 → 不再跟随（不得静默覆盖既有业务数据）。
        setPurchaseFollowsStock((d.purchaseUomId ?? "") === (d.stockUomId ?? ""));
        setSalesFollowsStock((d.salesUomId ?? "") === (d.stockUomId ?? ""));
        // 重新加载最新数据后：重置 dirty（409 reload 或首次加载均适用）
        setDirty(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"),
        );
        setLoadFailed(true);
      });
    return () => controller.abort();
  }, [id, reloadKey]);

  // F2-2 UX Hardening ②：409 VERSION_CONFLICT 后重新加载最新数据（重新 GET → 更新 version → 重置 dirty）
  const handleReload = () => {
    // 保持 dirty=true 直到 GET 成功：reload 失败时未保存修改仍需离开确认
    setError(null);
    setLoadFailed(false);
    setReloadKey((k) => k + 1);
  };

  /**
   * 联动（用户指令「物料管理：分类/单位/供应商加载失败 + 关联联动修复」）：
   * 库存单位是计量基准 —— 改库存单位时，仍处于「跟随」状态的采购单位 / 销售单位同步跟随；
   * 用户手工改过某字段则解除该字段的跟随，改回空值或与库存单位一致时恢复跟随。
   */
  const handleStockUomChange = (next: string) => {
    setStockUomId(next);
    if (purchaseFollowsStock) setPurchaseUomId(next);
    if (salesFollowsStock) setSalesUomId(next);
  };

  const handlePurchaseUomChange = (next: string) => {
    setPurchaseUomId(next);
    setPurchaseFollowsStock(next === "" || next === stockUomId);
  };

  const handleSalesUomChange = (next: string) => {
    setSalesUomId(next);
    setSalesFollowsStock(next === "" || next === stockUomId);
  };

  const handleSave = () => {
    if (submitting) return;
    if (!code.trim() || !name.trim()) {
      setError(new ApiClientError(400, "编码与名称为必填项", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload: Record<string, unknown> = {
      code: code.trim(),
      name: name.trim(),
      mnemonic: mnemonic.trim() || null,
      itemType: itemType || undefined,
      sourcingType: sourcingType || undefined,
      categoryId: categoryId || null,
      series: series.trim() || null,
      model: model.trim() || null,
      spec: spec.trim() || null,
      brand: brand.trim() || null,
      manufacturer: manufacturer.trim() || null,
      oemCode: oemCode.trim() || null,
      precisionGrade: precisionGrade.trim() || null,
      preload: preload.trim() || null,
      lifecycle: lifecycle || null,
      status: status || undefined,
      stockUomId: stockUomId || null,
      purchaseUomId: purchaseUomId || null,
      salesUomId: salesUomId || null,
      isSalable,
      isPurchasable,
      isManufacturable,
      description: description.trim() || null,
      version,
    };
    apiFetch<{ id: string }>(`/api/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
      .then(async () => {
        // 供应商与采购价同步（SupplierItem 增删改；删除被移除行 → 新增行 → 修改行 CAS）
        const curIds = new Set(supplierRows.map((r) => r.id).filter((v): v is string => Boolean(v)));
        for (const orig of originalSupplierItems) {
          if (!curIds.has(orig.id)) {
            await apiFetch(`/api/items/${id}/supplier-items/${orig.id}`, { method: "DELETE" });
          }
        }
        for (const row of supplierRows.filter((r) => r.supplierId)) {
          if (row.id) {
            const orig = originalSupplierItems.find((s) => s.id === row.id);
            const changed =
              orig &&
              (String(orig.purchasePrice ?? "") !== row.purchasePrice ||
                (orig.paymentTerm ?? "") !== row.paymentTerm ||
                orig.isPreferred !== row.isPreferred);
            if (changed) {
              await apiFetch(`/api/items/${id}/supplier-items/${row.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  version: row.version,
                  purchasePrice: row.purchasePrice ? Number(row.purchasePrice) : null,
                  paymentTerm: row.paymentTerm || null,
                  isPreferred: row.isPreferred,
                }),
              });
            }
          } else {
            await apiFetch(`/api/items/${id}/supplier-items`, {
              method: "POST",
              body: JSON.stringify({
                supplierId: row.supplierId,
                ...(row.purchasePrice ? { purchasePrice: Number(row.purchasePrice) } : {}),
                ...(row.paymentTerm ? { paymentTerm: row.paymentTerm } : {}),
                isPreferred: row.isPreferred,
              }),
            });
          }
        }
        router.push(`/items/${id}`);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  const updateSupplierRow = (index: number, patch: Partial<SupplierRow>) => {
    setSupplierRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeSupplierRow = (index: number) => {
    setSupplierRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  if (loadFailed) {
    return (
      <AppPage>
        <ErrorPanel error={loadError} />
      </AppPage>
    );
  }

  return (
    <EntityFormWorkspace
      title="编辑物料"
      description={`编码：${code}`}
      backHref={`/items/${id}`}
      mode="edit"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onReload={handleReload}
      onSave={handleSave}
      onCancel={() => router.push(`/items/${id}`)}
    >
      <Section title="基本信息">
        <FormField label="编码" required>
          <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="名称" required>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="助记码">
          <input value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="类型">
          <select value={itemType} onChange={(e) => setItemType(e.target.value)} className={inputClass}>
            <option value="">请选择</option>
            {ITEM_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="商品来源">
          <select value={sourcingType} onChange={(e) => setSourcingType(e.target.value)} className={inputClass}>
            {SOURCING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="分类">
          <ReferenceSelector
            value={categoryId}
            onChange={setCategoryId}
            options={categories.data.map((c) => ({ value: c.id, label: c.name ?? c.code ?? "" }))}
            placeholder="请选择分类"
            loading={categories.loading}
            error={categoryError}
            onRetry={categories.reload}
          />
        </FormField>
        <FormField label="品牌">
          <input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="制造商">
          <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} className={inputClass} />
        </FormField>
      </Section>

      <Section title="供应商与采购价">
        <div className="col-span-full space-y-2">
          <p className="text-xs text-ink-muted">
            一个商品可配置多个供应商（ADR-0012 §9）；「优选」供应商为采购单据选商品时自动带出的默认供应商。
          </p>
          {/* 供应商 / 付款条款引用源独立取数：失败必须可见且可单独重试（不静默显示空列表） */}
          <ReferenceErrorNote message={supplierError} onRetry={suppliers.reload} />
          <ReferenceErrorNote message={termError} onRetry={commercialTerms.reload} />
          {supplierRows.map((row, i) => (
            <div key={row.key} className="border-border flex flex-wrap items-end gap-3 rounded-md border p-3">
              <div className="min-w-[180px] flex-1">
                <label className="block text-xs text-ink-secondary">供应商</label>
                <select
                  value={row.supplierId}
                  onChange={(e) => updateSupplierRow(i, { supplierId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">请选择供应商</option>
                  {suppliers.data.map((s) => (
                    <option key={s.partner?.id ?? s.id} value={s.partner?.id ?? ""}>
                      {s.name ?? s.code ?? ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-ink-secondary">采购价</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={row.purchasePrice}
                  onChange={(e) => updateSupplierRow(i, { purchasePrice: e.target.value })}
                  className={`${inputClass} w-28`}
                  placeholder="> 0"
                />
              </div>
              <div>
                <label className="block text-xs text-ink-secondary">付款条款</label>
                <select
                  value={row.paymentTerm}
                  onChange={(e) => updateSupplierRow(i, { paymentTerm: e.target.value })}
                  className={inputClass}
                >
                  <option value="">不设置</option>
                  {commercialTerms.data.map((t) => (
                    <option key={t.id} value={t.code}>
                      {t.code} {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-1 text-xs text-ink-secondary">
                <input
                  type="checkbox"
                  checked={row.isPreferred}
                  onChange={(e) => updateSupplierRow(i, { isPreferred: e.target.checked })}
                />
                优选（默认）
              </label>
              <button
                type="button"
                onClick={() => removeSupplierRow(i)}
                disabled={supplierRows.length <= 1}
                className="border-border text-ink-secondary rounded-md border px-2 py-1 text-xs hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                删除
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setSupplierRows((prev) => [...prev, emptySupplierRow()])}
            className="border-border bg-surface text-ink-primary rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-surface-hover"
          >
            + 添加供应商
          </button>
        </div>
      </Section>
      <Section title="计量与状态">
        <FormField label="库存单位">
          <ReferenceSelector
            value={stockUomId}
            onChange={handleStockUomChange}
            options={uoms.data.map((u) => ({ value: u.id, label: u.name ?? u.code ?? "" }))}
            placeholder="请选择"
            loading={uoms.loading}
            error={uomError}
            onRetry={uoms.reload}
          />
          <p className="text-xs text-ink-muted">采购单位 / 销售单位默认跟随库存单位，可单独修改。</p>
        </FormField>
        <FormField label="采购单位">
          <ReferenceSelector
            value={purchaseUomId}
            onChange={handlePurchaseUomChange}
            options={uoms.data.map((u) => ({ value: u.id, label: u.name ?? u.code ?? "" }))}
            placeholder="请选择"
            loading={uoms.loading}
            error={uomError}
            onRetry={uoms.reload}
          />
          <p className="text-xs text-ink-muted">
            {purchaseFollowsStock ? "跟随库存单位" : "已单独设置（不再跟随库存单位）"}
          </p>
        </FormField>
        <FormField label="销售单位">
          <ReferenceSelector
            value={salesUomId}
            onChange={handleSalesUomChange}
            options={uoms.data.map((u) => ({ value: u.id, label: u.name ?? u.code ?? "" }))}
            placeholder="请选择"
            loading={uoms.loading}
            error={uomError}
            onRetry={uoms.reload}
          />
          <p className="text-xs text-ink-muted">
            {salesFollowsStock ? "跟随库存单位" : "已单独设置（不再跟随库存单位）"}
          </p>
        </FormField>
        <FormField label="生命周期">
          <select value={lifecycle} onChange={(e) => setLifecycle(e.target.value)} className={inputClass}>
            <option value="">请选择</option>
            {LIFECYCLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="状态">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FormField>
      </Section>

      <Section title="技术属性">
        <FormField label="系列">
          <input value={series} onChange={(e) => setSeries(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="型号">
          <input value={model} onChange={(e) => setModel(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="规格">
          <input value={spec} onChange={(e) => setSpec(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="OEM 编码">
          <input value={oemCode} onChange={(e) => setOemCode(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="产品精度等级">
          <input value={precisionGrade} onChange={(e) => setPrecisionGrade(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="预压值">
          <input value={preload} onChange={(e) => setPreload(e.target.value)} className={inputClass} />
        </FormField>
      </Section>

      <Section title="采购 / 销售标记">
        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <input type="checkbox" checked={isPurchasable} onChange={(e) => setIsPurchasable(e.target.checked)} />
          可采购
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <input type="checkbox" checked={isSalable} onChange={(e) => setIsSalable(e.target.checked)} />
          可销售
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <input type="checkbox" checked={isManufacturable} onChange={(e) => setIsManufacturable(e.target.checked)} />
          可生产
        </label>
        <FormField label="描述">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </FormField>
      </Section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("item", "edit")}>
      <AppPage>
        <ItemEditForm />
      </AppPage>
    </PermissionGuard>
  );
}