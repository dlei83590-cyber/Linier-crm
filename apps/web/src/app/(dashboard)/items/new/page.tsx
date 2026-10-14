"use client";

/**
 * Items — 新建物料（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（items.md）：backend create FINAL → 实现 Create。
 * 结构：AppPage + EntityFormWorkspace（Header → Sections → Validation → Save/Cancel）。
 * 分区：基本信息 / 计量单位 / 材料属性；不 40 行平铺。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace, ReferenceSelector } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { ITEM_TYPE_OPTIONS, ITEM_TYPE_INPUT_HINT, normalizeItemTypeInput } from "@/lib/item-type";
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


function ItemCreateForm() {
  const router = useRouter();
  // 引用数据源：分类 / 计量单位——**每源独立取数**（独立 loading/error/重试）。
  // 修复：此前单次 Promise.all 拉 4 个源，任一源失败会让分类 + 库存/采购/销售单位整组空白。
  // 供应商 / 付款条款两个源随「供应商与采购价」分区一并移除：既有 SupplierItem 数据不从此表单维护。
  const categories = useReferenceOptions<ItemOption>("/api/item-categories?pageSize=100");
  const uoms = useReferenceOptions<UomOption>("/api/unit-of-measures?pageSize=100");
  const categoryError = referenceErrorText(categories.error, REF_CATEGORY_PERMISSION);
  const uomError = referenceErrorText(uoms.error, REF_UOM_PERMISSION);

  // 表单字段（对齐 itemCreateSchema）
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  // 类型：手动输入（文本 + datalist 候选），提交前归一化为 DB 枚举码；初值为空（未填则不提交该字段）
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
  // 描述：原「采购 / 销售标记」分区已移除，用户只要求移除采购/销售标记，故描述移入「基本信息」分区末尾保留
  const [description, setDescription] = useState("");
  // 采购 / 销售单位默认「跟随库存单位」（联动）；某字段被手工改过即不再被覆盖，
  // 改回空值或与库存单位一致时恢复跟随（避免"改过一次就永远不跟随"的死状态）。
  const [purchaseFollowsStock, setPurchaseFollowsStock] = useState(true);
  const [salesFollowsStock, setSalesFollowsStock] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  // F2-2 UX Hardening ①：Dirty-State Guard（填写内容后离开需确认）
  const [dirty, setDirty] = useState(false);

  /**
   * 联动（用户指令「物料管理：分类/单位加载失败 + 关联联动修复」）：
   * 库存单位是计量基准 —— 选定后，仍处于「跟随」状态的采购单位 / 销售单位同步带出同一单位；
   * 用户手工改过某字段则解除该字段的跟随（不再被覆盖），改回空值或与库存单位一致时恢复跟随。
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
    // 类型改为手动输入：提交前归一化为 DB 枚举码（接受枚举码或中文业务名）。
    // 无法识别时必须阻止提交并明确提示，绝不静默改写用户输入（禁止 silent degradation）。
    const normalizedItemType = normalizeItemTypeInput(itemType);
    if (itemType.trim() && !normalizedItemType) {
      setError(new ApiClientError(400, "类型无法识别，请填写：" + ITEM_TYPE_INPUT_HINT, "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload: Record<string, unknown> = {
      code: code.trim(),
      name: name.trim(),
      mnemonic: mnemonic.trim() || undefined,
      itemType: normalizedItemType || undefined,
      sourcingType: sourcingType || undefined,
      categoryId: categoryId || undefined,
      series: series.trim() || undefined,
      model: model.trim() || undefined,
      spec: spec.trim() || undefined,
      oemCode: oemCode.trim() || undefined,
      description: description.trim() || undefined,
      stockUomId: stockUomId || undefined,
      purchaseUomId: purchaseUomId || undefined,
      salesUomId: salesUomId || undefined,
    };
    apiFetch<{ id: string }>("/api/items", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then((body) => {
        // 创建成功后直接进入详情页（「供应商与采购价」分区已移除，不再逐行 POST /supplier-items）
        router.push(`/items/${body.data.id}`);
      })
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
          {/* 手动输入：文本输入 + datalist 候选（共享模块 @/lib/item-type），提交前归一化为 DB 枚举码 */}
          <input
            list="item-type-options-new"
            value={itemType}
            onChange={(e) => setItemType(e.target.value)}
            className={inputClass}
            placeholder={ITEM_TYPE_INPUT_HINT}
          />
          <datalist id="item-type-options-new">
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
    <PermissionGuard permission={actionPermission("item", "create")}>
      <AppPage>
        <ItemCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}