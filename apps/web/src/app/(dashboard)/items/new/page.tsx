"use client";

/**
 * Items — 新建物料（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（items.md）：backend create FINAL → 实现 Create。
 * 结构：AppPage + EntityFormWorkspace（Header → 分区 → Validation → Save/Cancel）。
 *
 * 第 3 轮表单收敛（用户确认的产品决策）：
 * - 表单只剩一个分区「基本信息」，字段顺序固定：
 *   编码 → 名称 → 系列 → 型号 → 规格 → 类型 → 分类 → 计量单位 → OEM 编码；
 * - 「类型」= 自由文本：保存时由服务端按名称自动匹配或新建「物料分类」，并把结果写入 categoryId
 *   （类型本身不再写 itemType），因此彻底删除上一轮的枚举归一化与
 *   「类型无法识别，请填写：…」错误（那正是用户报告的 bug），也不再依赖 @/lib/item-type；
 * - 「计量单位」= stockUomId（库存单位列），标签显示为「计量单位」；
 *   移除「采购单位」「销售单位」两个下拉及其全部 follow / 联动 state 与 handler；
 * - 移除字段：助记码 / 商品来源 / 描述 / 采购单位 / 销售单位（state、常量、payload 键一并清理）。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace, ReferenceSelector } from "@/components/workspace";
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
  // 单次 Promise.all 拉多源会让任一源失败导致整组下拉空白，故保持逐源独立。
  const categories = useReferenceOptions<ItemOption>("/api/item-categories?pageSize=100");
  const uoms = useReferenceOptions<UomOption>("/api/unit-of-measures?pageSize=100");
  const categoryError = referenceErrorText(categories.error, REF_CATEGORY_PERMISSION);
  const uomError = referenceErrorText(uoms.error, REF_UOM_PERMISSION);

  // 表单字段（对齐 itemCreateSchema）
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [series, setSeries] = useState("");
  const [model, setModel] = useState("");
  const [spec, setSpec] = useState("");
  // 类型：自由文本输入，不写 itemType——保存时服务端按名称匹配或新建「物料分类」，结果落到 categoryId。
  const [itemTypeText, setItemTypeText] = useState("");
  const [categoryId, setCategoryId] = useState("");
  // 计量单位 = 库存单位（stockUomId）；采购单位 / 销售单位字段已随产品决策移除。
  const [stockUomId, setStockUomId] = useState("");
  const [oemCode, setOemCode] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  // F2-2 UX Hardening ①：Dirty-State Guard（填写内容后离开需确认）
  const [dirty, setDirty] = useState(false);

  /**
   * 「材料类型」与「分类」**不联动**（用户指令 2026-09-27）：两个控件各自独立，
   * 输入材料类型不会自动选中分类，选择分类也不会回填材料类型。
   *
   * 两者最终都写同一个 categoryId ⇒ 都填写且不一致时**以用户最近修改的那个为准**
   * （last-write-wins，不再拦截保存），并在字段下方用一行提示说明以谁为准。
   * 材料类型文本非空且最近改的是它 → 交服务端 categoryName 匹配/新建分类；
   * 最近改的是分类下拉（含编辑页只回填未改动的情形）→ 提交 categoryId。
   */
  const [classificationSource, setClassificationSource] = useState<"type" | "category">("category");

  /** 两者都填且指向不同分类（分类数据未加载时不做判断，避免误报） */
  const classificationConflict = (): boolean => {
    if (!itemTypeText.trim() || !categoryId) return false;
    const selected = categories.data.find((c) => c.id === categoryId);
    if (!selected) return false;
    return (selected.name ?? "").trim().toLowerCase() !== itemTypeText.trim().toLowerCase();
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
      series: series.trim() || undefined,
      model: model.trim() || undefined,
      spec: spec.trim() || undefined,
      oemCode: oemCode.trim() || undefined,
      stockUomId: stockUomId || undefined,
    };
    // 分类只提交二者之一：以**最近修改**的入口为准（材料类型 → categoryName；分类下拉 → categoryId），
    // 两者都为空则不提交分类字段。
    const categoryName = itemTypeText.trim();
    if (classificationSource === "type" && categoryName) {
      payload.categoryName = categoryName;
    } else if (categoryId) {
      payload.categoryId = categoryId;
    } else if (categoryName) {
      // 分类被清空但材料类型仍有文字：不得静默丢弃用户输入
      payload.categoryName = categoryName;
    }
    apiFetch<{ id: string }>("/api/items", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then((body) => {
        // 创建成功后直接进入详情页
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
        <FormField label="系列">
          <input value={series} onChange={(e) => setSeries(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="型号">
          <input value={model} onChange={(e) => setModel(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="规格">
          <input value={spec} onChange={(e) => setSpec(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="材料类型" hint="输入后自动匹配或新建物料分类（与分类不联动）">
          {/* 自由文本：不做枚举归一化，提交时以 categoryName 交给服务端匹配或新建分类 */}
          <input
            value={itemTypeText}
            onChange={(e) => {
              setItemTypeText(e.target.value);
              setClassificationSource("type");
            }}
            className={inputClass}
            placeholder="输入材料类型"
          />
          {classificationConflict() && classificationSource === "category" ? (
            <p className="text-xs text-ink-muted">与「分类」不同：保存时以「分类」为准</p>
          ) : null}
        </FormField>
        <FormField label="分类">
          <ReferenceSelector
            value={categoryId}
            onChange={(id) => {
              setCategoryId(id);
              setClassificationSource("category");
            }}
            options={categories.data.map((c) => ({ value: c.id, label: c.name ?? c.code ?? "" }))}
            placeholder="请选择分类"
            loading={categories.loading}
            error={categoryError}
            onRetry={categories.reload}
          />
          {classificationConflict() && classificationSource === "type" ? (
            <p className="text-xs text-ink-muted">与「材料类型」不同：保存时以「材料类型」为准</p>
          ) : null}
        </FormField>
        <FormField label="计量单位">
          <ReferenceSelector
            value={stockUomId}
            onChange={setStockUomId}
            options={uoms.data.map((u) => ({ value: u.id, label: u.name ?? u.code ?? "" }))}
            placeholder="请选择"
            loading={uoms.loading}
            error={uomError}
            onRetry={uoms.reload}
          />
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
