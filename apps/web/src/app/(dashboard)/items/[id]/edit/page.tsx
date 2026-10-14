"use client";

/**
 * Items — 编辑物料（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（items.md）：backend edit FINAL（PATCH + version CAS）→ 实现 Edit。
 * CAS：表单携带详情返回的 version，409 冲突时提示刷新重试（ErrorPanel 统一呈现）。
 *
 * 物料管理改造（第 3 轮，用户确认）：
 * - 表单只剩**一个分区**「基本信息」，字段顺序严格固定：
 *   编码 → 名称 → 系列 → 型号 → 规格 → 类型 → 分类 → 计量单位 → OEM 编码；
 * - 「类型」改为**自由文本**：保存时按文本自动匹配 / 新建「物料分类」并写入 categoryId
 *   （类型本身不再写 itemType；上一轮的枚举归一化逻辑与「类型无法识别」错误已彻底删除）；
 * - 「计量单位」= stockUomId（库存单位列），采购单位 / 销售单位下拉及其跟随联动一并移除；
 * - 移除字段：助记码 / 商品来源 / 描述 / 采购单位 / 销售单位。
 *   这些字段**不再出现在 payload 中** ⇒ PATCH 不触碰对应列，既有数据保留（不写 null 覆盖）。
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
  series?: string | null;
  model?: string | null;
  spec?: string | null;
  oemCode?: string | null;
  stockUomId?: string | null;
  categoryId?: string | null;
  /** 详情 GET 已 include 完整 category：类型输入用分类名回填（类型 = 分类的文本入口） */
  category?: { id: string; code: string | null; name: string | null } | null;
  version: number;
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


function ItemEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  // 引用数据源：分类 / 计量单位——**每源独立取数**（独立 loading/error/重试）。
  // 修复 ①：此前与详情 GET 放在同一个 Promise.all，任一引用源失败会把整个编辑页打成 ErrorPanel；
  // 修复 ②：任一源失败也不再让分类 / 计量单位下拉空白。
  const categories = useReferenceOptions<ItemOption>("/api/item-categories?pageSize=100");
  const uoms = useReferenceOptions<UomOption>("/api/unit-of-measures?pageSize=100");
  const categoryError = referenceErrorText(categories.error, REF_CATEGORY_PERMISSION);
  const uomError = referenceErrorText(uoms.error, REF_UOM_PERMISSION);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [series, setSeries] = useState("");
  const [model, setModel] = useState("");
  const [spec, setSpec] = useState("");
  // 类型 = 自由文本（不是 DB 枚举）：只作为「物料分类」的文本入口，保存时匹配已有分类或由服务端新建
  const [itemTypeText, setItemTypeText] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [stockUomId, setStockUomId] = useState("");
  const [oemCode, setOemCode] = useState("");
  const [version, setVersion] = useState(0);

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
        setSeries(d.series ?? "");
        setModel(d.model ?? "");
        setSpec(d.spec ?? "");
        // 类型输入回填分类名：类型与分类是同一事实的两个入口，回填名称为「不修改即一致」
        setItemTypeText(d.category?.name ?? "");
        setCategoryId(d.categoryId ?? "");
        setStockUomId(d.stockUomId ?? "");
        setOemCode(d.oemCode ?? "");
        setVersion(d.version);
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
   * 「类型」↔「分类」双向联动（同一事实的两个入口）：
   * 类型文本变化 → 与某个已有分类同名（trim + 忽略大小写）就自动选中该分类；
   * 无匹配则清空选择（保存时由服务端按类型文本新建分类）。
   */
  const handleTypeTextChange = (raw: string) => {
    setItemTypeText(raw);
    const key = raw.trim().toLowerCase();
    const match = categories.data.find((c) => (c.name ?? "").trim().toLowerCase() === key);
    setCategoryId(match ? match.id : "");
  };

  /** 分类下拉变化 → 反向把分类名回填到类型输入 */
  const handleCategoryChange = (id: string) => {
    setCategoryId(id);
    const c = categories.data.find((x) => x.id === id);
    setItemTypeText(c?.name ?? "");
  };

  const handleSave = () => {
    if (submitting) return;
    if (!code.trim() || !name.trim()) {
      setError(new ApiClientError(400, "编码与名称为必填项", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    // payload 只提交本表单仍维护的字段：mnemonic / sourcingType / description / purchaseUomId / salesUomId /
    // itemType 不再提交 ⇒ PATCH 不触碰这些列，既有数据保留（不显式置 null 覆盖）。
    const payload: Record<string, unknown> = {
      code: code.trim(),
      name: name.trim(),
      series: series.trim() || null,
      model: model.trim() || null,
      spec: spec.trim() || null,
      oemCode: oemCode.trim() || null,
      stockUomId: stockUomId || null,
      version,
    };
    // 分类二者之一：类型文本非空 → 交服务端匹配/新建（categoryName）；否则回落到已选分类（categoryId）；
    // 两者都空则不提交分类字段（不触碰既有 categoryId）。
    const typeText = itemTypeText.trim();
    if (typeText) payload.categoryName = typeText;
    else if (categoryId) payload.categoryId = categoryId;

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
        <FormField label="系列">
          <input value={series} onChange={(e) => setSeries(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="型号">
          <input value={model} onChange={(e) => setModel(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="规格">
          <input value={spec} onChange={(e) => setSpec(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="类型" hint="输入后自动匹配/新建物料分类（与下方「分类」联动）">
          {/* 自由文本：不做枚举归一化；同名分类自动选中，否则保存时新建分类 */}
          <input
            value={itemTypeText}
            onChange={(e) => handleTypeTextChange(e.target.value)}
            className={inputClass}
            placeholder="输入类型名称"
          />
        </FormField>
        <FormField label="分类">
          <ReferenceSelector
            value={categoryId}
            onChange={handleCategoryChange}
            options={categories.data.map((c) => ({ value: c.id, label: c.name ?? c.code ?? "" }))}
            placeholder="请选择分类"
            loading={categories.loading}
            error={categoryError}
            onRetry={categories.reload}
          />
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
    <PermissionGuard permission={actionPermission("item", "edit")}>
      <AppPage>
        <ItemEditForm />
      </AppPage>
    </PermissionGuard>
  );
}
