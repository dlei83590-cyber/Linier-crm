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
import { AppPage, EntityFormWorkspace, ReferenceSelector, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface ItemOption {
  id: string;
  code: string | null;
  name: string | null;
}

interface ItemDetail {
  id: string;
  code: string;
  name: string;
  mnemonic?: string | null;
  itemType?: string | null;
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
  stockUomId?: string | null;
  purchaseUomId?: string | null;
  salesUomId?: string | null;
  categoryId?: string | null;
  version: number;
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

const inputClass = INPUT_CLASS;

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

  const [categories, setCategories] = useState<ItemOption[]>([]);
  const [uoms, setUoms] = useState<ItemOption[]>([]);
  const [selectorsLoading, setSelectorsLoading] = useState(true);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [itemType, setItemType] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [series, setSeries] = useState("");
  const [model, setModel] = useState("");
  const [variant, setVariant] = useState("");
  const [spec, setSpec] = useState("");
  const [brand, setBrand] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [oemCode, setOemCode] = useState("");
  const [barcode, setBarcode] = useState("");
  const [drawingNo, setDrawingNo] = useState("");
  const [drawingVersion, setDrawingVersion] = useState("");
  const [revision, setRevision] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [stockUomId, setStockUomId] = useState("");
  const [purchaseUomId, setPurchaseUomId] = useState("");
  const [salesUomId, setSalesUomId] = useState("");
  const [isSalable, setIsSalable] = useState(true);
  const [isPurchasable, setIsPurchasable] = useState(true);
  const [isManufacturable, setIsManufacturable] = useState(false);
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState(0);

  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  // F2-2 UX Hardening ①：Dirty-State Guard（修改后离开需确认）
  const [dirty, setDirty] = useState(false);
  // F2-2 UX Hardening ②：409 CAS 后重新加载（重新 GET → 更新 version → 重置 dirty）
  const [reloadKey, setReloadKey] = useState(0);

  // 加载详情 + Selector 数据源（reloadKey 变化触发重新加载，供 409 后重取最新数据）
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<ItemDetail>(`/api/items/${id}`, { signal: controller.signal }),
      apiFetch<ItemOption[]>("/api/item-categories?pageSize=100", { signal: controller.signal }),
      apiFetch<ItemOption[]>("/api/unit-of-measures?pageSize=100", { signal: controller.signal }),
    ])
      .then(([itemBody, catBody, uomBody]) => {
        const d = itemBody.data;
        setCode(d.code);
        setName(d.name);
        setMnemonic(d.mnemonic ?? "");
        setItemType(d.itemType ?? "");
        setCategoryId(d.categoryId ?? "");
        setSeries(d.series ?? "");
        setModel(d.model ?? "");
        setVariant(d.variant ?? "");
        setSpec(d.spec ?? "");
        setBrand(d.brand ?? "");
        setManufacturer(d.manufacturer ?? "");
        setOemCode(d.oemCode ?? "");
        setBarcode(d.barcode ?? "");
        setDrawingNo(d.drawingNo ?? "");
        setDrawingVersion(d.drawingVersion ?? "");
        setRevision(d.revision ?? "");
        setLifecycle(d.lifecycle ?? "");
        setStatus(d.status ?? "ACTIVE");
        setStockUomId(d.stockUomId ?? "");
        setPurchaseUomId(d.purchaseUomId ?? "");
        setSalesUomId(d.salesUomId ?? "");
        setIsSalable(d.isSalable ?? true);
        setIsPurchasable(d.isPurchasable ?? true);
        setIsManufacturable(d.isManufacturable ?? false);
        setDescription(d.description ?? "");
        setVersion(d.version);
        setCategories(catBody.data);
        setUoms(uomBody.data);
        setSelectorsLoading(false);
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
      categoryId: categoryId || null,
      series: series.trim() || null,
      model: model.trim() || null,
      variant: variant.trim() || null,
      spec: spec.trim() || null,
      brand: brand.trim() || null,
      manufacturer: manufacturer.trim() || null,
      oemCode: oemCode.trim() || null,
      barcode: barcode.trim() || null,
      drawingNo: drawingNo.trim() || null,
      drawingVersion: drawingVersion.trim() || null,
      revision: revision.trim() || null,
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
      .then(() => router.push(`/items/${id}`))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
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
        <FormField label="分类">
          <ReferenceSelector
            value={categoryId}
            onChange={setCategoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name ?? c.code ?? "" }))}
            placeholder="请选择分类"
            loading={selectorsLoading}
          />
        </FormField>
        <FormField label="品牌">
          <input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="制造商">
          <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} className={inputClass} />
        </FormField>
      </Section>

      <Section title="计量与状态">
        <FormField label="库存单位">
          <ReferenceSelector
            value={stockUomId}
            onChange={setStockUomId}
            options={uoms.map((u) => ({ value: u.id, label: u.name ?? u.code ?? "" }))}
            placeholder="请选择"
            loading={selectorsLoading}
          />
        </FormField>
        <FormField label="采购单位">
          <ReferenceSelector
            value={purchaseUomId}
            onChange={setPurchaseUomId}
            options={uoms.map((u) => ({ value: u.id, label: u.name ?? u.code ?? "" }))}
            placeholder="请选择"
            loading={selectorsLoading}
          />
        </FormField>
        <FormField label="销售单位">
          <ReferenceSelector
            value={salesUomId}
            onChange={setSalesUomId}
            options={uoms.map((u) => ({ value: u.id, label: u.name ?? u.code ?? "" }))}
            placeholder="请选择"
            loading={selectorsLoading}
          />
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
        <FormField label="变型">
          <input value={variant} onChange={(e) => setVariant(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="规格">
          <input value={spec} onChange={(e) => setSpec(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="OEM 编码">
          <input value={oemCode} onChange={(e) => setOemCode(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="条码">
          <input value={barcode} onChange={(e) => setBarcode(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="图号">
          <input value={drawingNo} onChange={(e) => setDrawingNo(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="图版">
          <input value={drawingVersion} onChange={(e) => setDrawingVersion(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="版本">
          <input value={revision} onChange={(e) => setRevision(e.target.value)} className={inputClass} />
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