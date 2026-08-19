"use client";

/**
 * Items — 新建物料（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（items.md）：backend create FINAL → 实现 Create。
 * 结构：AppPage + EntityFormWorkspace（Header → Sections → Validation → Save/Cancel）。
 * 分区：基本信息 / 计量与状态 / 技术属性 / 采购销售标记；不 40 行平铺。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace, ReferenceSelector } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface ItemOption {
  id: string;
  code: string | null;
  name: string | null;
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


function ItemCreateForm() {
  const router = useRouter();
  const [categories, setCategories] = useState<ItemOption[]>([]);
  const [uoms, setUoms] = useState<ItemOption[]>([]);
  const [selectorsLoading, setSelectorsLoading] = useState(true);
  const [selectorsError, setSelectorsError] = useState<string | null>(null);

  // 表单字段（对齐 itemCreateSchema）
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

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  // F2-2 UX Hardening ①：Dirty-State Guard（填写内容后离开需确认）
  const [dirty, setDirty] = useState(false);

  // Selector 数据源：分类 + 计量单位（GET 已 FINAL）
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<ItemOption[]>("/api/item-categories?pageSize=100", { signal: controller.signal }),
      apiFetch<ItemOption[]>("/api/unit-of-measures?pageSize=100", { signal: controller.signal }),
    ])
      .then(([catBody, uomBody]) => {
        setCategories(catBody.data);
        setUoms(uomBody.data);
        setSelectorsLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setSelectorsError("加载分类/计量单位失败");
        setSelectorsLoading(false);
      });
    return () => controller.abort();
  }, []);

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
      mnemonic: mnemonic.trim() || undefined,
      itemType: itemType || undefined,
      categoryId: categoryId || undefined,
      series: series.trim() || undefined,
      model: model.trim() || undefined,
      variant: variant.trim() || undefined,
      spec: spec.trim() || undefined,
      brand: brand.trim() || undefined,
      manufacturer: manufacturer.trim() || undefined,
      oemCode: oemCode.trim() || undefined,
      barcode: barcode.trim() || undefined,
      drawingNo: drawingNo.trim() || undefined,
      drawingVersion: drawingVersion.trim() || undefined,
      revision: revision.trim() || undefined,
      lifecycle: lifecycle || undefined,
      status: status || undefined,
      stockUomId: stockUomId || undefined,
      purchaseUomId: purchaseUomId || undefined,
      salesUomId: salesUomId || undefined,
      isSalable,
      isPurchasable,
      isManufacturable,
      description: description.trim() || undefined,
    };
    apiFetch<{ id: string }>("/api/items", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then((body) => router.push(`/items/${body.data.id}`))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  return (
    <EntityFormWorkspace
      title="新建物料"
      description="创建统一物料主数据"
      backHref="/items"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/items")}
    >
      <Section title="基本信息">
        <FormField label="编码" required>
          <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} placeholder="唯一编码" />
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
            error={selectorsError}
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
            error={selectorsError}
          />
        </FormField>
        <FormField label="采购单位">
          <ReferenceSelector
            value={purchaseUomId}
            onChange={setPurchaseUomId}
            options={uoms.map((u) => ({ value: u.id, label: u.name ?? u.code ?? "" }))}
            placeholder="请选择"
            loading={selectorsLoading}
            error={selectorsError}
          />
        </FormField>
        <FormField label="销售单位">
          <ReferenceSelector
            value={salesUomId}
            onChange={setSalesUomId}
            options={uoms.map((u) => ({ value: u.id, label: u.name ?? u.code ?? "" }))}
            placeholder="请选择"
            loading={selectorsLoading}
            error={selectorsError}
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
    <PermissionGuard permission={actionPermission("item", "create")}>
      <AppPage>
        <ItemCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}