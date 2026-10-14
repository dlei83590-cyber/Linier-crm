"use client";

/**
 * Items — 编辑物料（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（items.md）：backend edit FINAL（PATCH + version CAS）→ 实现 Edit。
 * CAS：表单携带详情返回的 version，409 冲突时提示刷新重试（ErrorPanel 统一呈现）。
 *
 * 物料管理改造（2026-09-27）：类型改为手动输入（+ 候选 datalist，提交前归一化为 DB 枚举码）；
 * 移除 品牌 / 制造商 / 生命周期 / 状态 / 产品精度等级 / 预压值 / 采购销售标记 / 供应商与采购价 分区；
 * 「描述」保留并移入基本信息。本表单不再提交的字段 PATCH 不会触碰 ⇒ 既有数据保留（不维护 ≠ 清空）。
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace, ReferenceSelector, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useReferenceOptions, referenceErrorText } from "@/lib/use-reference-options";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { ITEM_TYPE_OPTIONS, ITEM_TYPE_INPUT_HINT, normalizeItemTypeInput, itemTypeLabel } from "@/lib/item-type";

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

interface ItemDetail {
  id: string;
  code: string;
  name: string;
  mnemonic?: string | null;
  itemType?: string | null;
  sourcingType?: string | null;
  series?: string | null;
  model?: string | null;
  spec?: string | null;
  oemCode?: string | null;
  description?: string | null;
  stockUomId?: string | null;
  purchaseUomId?: string | null;
  salesUomId?: string | null;
  categoryId?: string | null;
  version: number;
}

const SOURCING_OPTIONS = [
  { value: "BOUGHT", label: "外购（直接采购/销售）" },
  { value: "SELF_MANUFACTURED", label: "自产（物料组合，本厂加工）" },
  { value: "OEM_OUTSOURCED", label: "OEM 外协（含工不含料：我方供料 + 加工费）" },
  { value: "OEM_OUTSOURCED_FULL", label: "OEM 外协（含工含料：外协厂包工包料）" },
];

const inputClass = INPUT_CLASS;

/** 引用源对应的后端权限码（403 时在字段上明确"缺哪个权限"，便于管理员授权） */
const REF_CATEGORY_PERMISSION = "item-category:view";
const REF_UOM_PERMISSION = "unit-of-measure:view";

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

  // 引用数据源：分类 / 计量单位——**每源独立取数**（独立 loading/error/重试）。
  // 修复 ①：此前与详情 GET 放在同一个 Promise.all，任一引用源失败会把整个编辑页打成 ErrorPanel；
  // 修复 ②：任一源失败也不再让分类 + 库存/采购/销售单位整组下拉空白。
  const categories = useReferenceOptions<ItemOption>("/api/item-categories?pageSize=100");
  const uoms = useReferenceOptions<UomOption>("/api/unit-of-measures?pageSize=100");
  const categoryError = referenceErrorText(categories.error, REF_CATEGORY_PERMISSION);
  const uomError = referenceErrorText(uoms.error, REF_UOM_PERMISSION);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [itemType, setItemType] = useState("");
  const [sourcingType, setSourcingType] = useState("BOUGHT");
  const [categoryId, setCategoryId] = useState("");
  const [series, setSeries] = useState("");
  const [model, setModel] = useState("");
  const [spec, setSpec] = useState("");
  const [oemCode, setOemCode] = useState("");
  const [stockUomId, setStockUomId] = useState("");
  const [purchaseUomId, setPurchaseUomId] = useState("");
  const [salesUomId, setSalesUomId] = useState("");
  const [description, setDescription] = useState("");
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
        // 类型为手动输入 → 用中文业务名回填：normalizeItemTypeInput 同时接受中文名与枚举码，
        // 因此「未修改就提交」的结果与库中值一致；库中若有未知值则原样展示（itemTypeLabel 原样返回）。
        setItemType(d.itemType ? itemTypeLabel(d.itemType) : "");
        setSourcingType(d.sourcingType ?? "BOUGHT");
        setCategoryId(d.categoryId ?? "");
        setSeries(d.series ?? "");
        setModel(d.model ?? "");
        setSpec(d.spec ?? "");
        setOemCode(d.oemCode ?? "");
        setStockUomId(d.stockUomId ?? "");
        setPurchaseUomId(d.purchaseUomId ?? "");
        setSalesUomId(d.salesUomId ?? "");
        setDescription(d.description ?? "");
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
   * 联动（用户指令「物料管理：分类/单位加载失败 + 关联联动修复」）：
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
    // 类型手动输入，但 Item.itemType 仍是 DB 枚举 → 提交前必须归一化（枚举码 / 中文业务名，忽略大小写与首尾空格）。
    // 无法识别：明确报错并阻止提交，绝不静默改写用户输入，也不回退为默认值。
    const normalizedItemType = normalizeItemTypeInput(itemType);
    if (itemType.trim() && !normalizedItemType) {
      setError(new ApiClientError(400, "类型无法识别，请填写：" + ITEM_TYPE_INPUT_HINT, "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    // payload 只提交本表单仍维护的字段。brand / manufacturer / lifecycle / status / precisionGrade / preload /
    // isSalable / isPurchasable / isManufacturable 不再提交 ⇒ PATCH 不触碰这些列，既有数据保留（不显式置 null）。
    const payload: Record<string, unknown> = {
      code: code.trim(),
      name: name.trim(),
      mnemonic: mnemonic.trim() || null,
      itemType: normalizedItemType || undefined,
      sourcingType: sourcingType || undefined,
      categoryId: categoryId || null,
      series: series.trim() || null,
      model: model.trim() || null,
      spec: spec.trim() || null,
      oemCode: oemCode.trim() || null,
      description: description.trim() || null,
      stockUomId: stockUomId || null,
      purchaseUomId: purchaseUomId || null,
      salesUomId: salesUomId || null,
      version,
    };
    apiFetch<{ id: string }>(`/api/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
      .then(() => {
        // 供应商与采购价不再由表单维护：保存后不再调用任何 supplier-items 接口（既有 SupplierItem 数据不删不改）
        router.push(`/items/${id}`);
      })
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
          {/* 手动输入 + 候选：Item.itemType 仍是 DB 枚举，提交前由 normalizeItemTypeInput 归一化（候选用中文业务名，与回填一致） */}
          <input
            list="item-type-options-edit"
            value={itemType}
            onChange={(e) => setItemType(e.target.value)}
            className={inputClass}
            placeholder={ITEM_TYPE_INPUT_HINT}
          />
          <datalist id="item-type-options-edit">
            {ITEM_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.label} />
            ))}
          </datalist>
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
        <FormField label="描述">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </FormField>
      </Section>

      <Section title="计量单位">
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
      </Section>

      <Section title="材料属性">
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