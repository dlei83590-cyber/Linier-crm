"use client";

/**
 * BOM Create — 新建物料配方（P-4 Item Sourcing，ADR-0049 + UI-09 FE2.0 表单统一）
 *
 * 契约：POST /api/boms（bom:create），bomVersion = max+1，bomNo 自动生成（BOM-{成品code}-{version}）。
 * 原料行：系数 qtyPerFinishedUnit（吨→米/件/个在此表达）+ 损耗率 lossRate；单位必须 = 原料库存单位（选择物料自动带出）。
 *
 * UI-09：迁移至 EntityFormWorkspace（Dirty-State Guard / 409 冲突面板 / ErrorPanel /
 * 统一 Save/Cancel），移除页面级 window.confirm。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { FormField } from "@/components/ui/form-field";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface ItemOption {
  id: string;
  code: string | null;
  name: string | null;
  model?: string | null;
  stockUom?: { id: string; code: string | null; symbol: string | null } | null;
}

interface BomLineForm {
  key: string;
  componentItemId: string;
  componentUomId: string;
  qtyPerFinishedUnit: string;
  lossRate: string;
}

const emptyLine = (): BomLineForm => ({
  key: crypto.randomUUID(),
  componentItemId: "",
  componentUomId: "",
  qtyPerFinishedUnit: "",
  lossRate: "0",
});

const inputClass = INPUT_CLASS;

function BomCreateForm() {
  const router = useRouter();
  const [items, setItems] = useState<ItemOption[]>([]);
  const [finishedItemId, setFinishedItemId] = useState("");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<BomLineForm[]>([emptyLine()]);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<ItemOption[]>("/api/items?pageSize=200", { signal: controller.signal })
      .then((body) => setItems(Array.isArray(body.data) ? body.data : []))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载物料失败", "NETWORK_ERROR"));
      });
    return () => controller.abort();
  }, []);

  const markDirty = () => setDirty(true);

  const updateLine = (index: number, patch: Partial<BomLineForm>) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    markDirty();
  };

  const handleComponentChange = (index: number, itemId: string) => {
    const item = items.find((it) => it.id === itemId);
    updateLine(index, {
      componentItemId: itemId,
      componentUomId: item?.stockUom?.id ?? "",
    });
  };

  const addLine = () => {
    setLines((prev) => [...prev, emptyLine()]);
    markDirty();
  };
  const removeLine = (index: number) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
    markDirty();
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const errs: Record<string, string> = {};
    if (!finishedItemId) errs.finishedItemId = "请选择成品";
    if (lines.length === 0) errs.lines = "至少需要一行原料";
    const validLines = lines.filter((l) => l.componentItemId);
    for (const l of validLines) {
      if (!l.qtyPerFinishedUnit || Number(l.qtyPerFinishedUnit) <= 0) {
        errs["qty:" + l.key] = "系数必须大于 0";
      }
      if (l.lossRate !== "" && (Number(l.lossRate) < 0 || Number(l.lossRate) >= 1)) {
        errs["loss:" + l.key] = "损耗率必须在 [0, 1)";
      }
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    setError(null);
    try {
      const body = await apiFetch<{ id: string }>("/api/boms", {
        method: "POST",
        body: JSON.stringify({
          finishedItemId,
          remark: remark.trim() || null,
          lines: validLines.map((l) => ({
            componentItemId: l.componentItemId,
            componentUomId: l.componentUomId,
            qtyPerFinishedUnit: Number(l.qtyPerFinishedUnit),
            lossRate: l.lossRate === "" ? 0 : Number(l.lossRate),
          })),
        }),
      });
      router.push(`/inventory/boms/${body.data.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <AppPage>
        <div className="border-border bg-surface shadow-elevation-sm rounded-lg border p-6">
          <p className="text-sm text-status-danger-text">加载物料失败：{loadError.message}</p>
        </div>
      </AppPage>
    );
  }

  return (
    <EntityFormWorkspace
      title="新建物料配方"
      description="为成品维护物料组合固定配方：1 成品 = N 行原料；需求 = 成品数 × 系数 × (1 + 损耗率)（吨→米/件/个在系数表达）"
      backHref="/inventory/boms"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSubmit}
      onCancel={() => router.push("/inventory/boms")}
      saveLabel="保存配方"
    >
      <section className="rounded-md border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-primary">配方信息</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="成品" required>
            <select
              value={finishedItemId}
              onChange={(e) => {
                setFinishedItemId(e.target.value);
                markDirty();
              }}
              className={inputClass}
            >
              <option value="">请选择成品</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {`${it.code ?? ""} ${it.name ?? ""}`.trim()}
                </option>
              ))}
            </select>
            {fieldErrors.finishedItemId ? (
              <span className="text-xs text-status-danger-text">{fieldErrors.finishedItemId}</span>
            ) : null}
          </FormField>
          <FormField label="备注">
            <input value={remark} onChange={(e) => { setRemark(e.target.value); markDirty(); }} className={inputClass} />
          </FormField>
        </div>
      </section>

      <section className="rounded-md border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-primary">原料行（配方系数）</h2>
          <button type="button" onClick={addLine} className="rounded-md border border-border px-3 py-1 text-xs font-medium text-ink-primary hover:bg-canvas">
            + 添加原料
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={l.key} className="border-border flex flex-wrap items-end gap-3 rounded-md border p-3">
              <div className="min-w-[200px] flex-1">
                <span className="block text-xs text-ink-secondary">原料</span>
                <select value={l.componentItemId} onChange={(e) => handleComponentChange(i, e.target.value)} className={inputClass}>
                  <option value="">请选择原料</option>
                  {items
                    .filter((it) => it.id !== finishedItemId)
                    .map((it) => (
                      <option key={it.id} value={it.id}>
                        {`${it.code ?? ""} ${it.name ?? ""}`.trim()}
                      </option>
                    ))}
                </select>
              </div>
              <div className="w-28">
                <span className="block text-xs text-ink-secondary">单位（库存单位）</span>
                <input value={l.componentUomId ? items.find((it) => it.id === l.componentItemId)?.stockUom?.symbol ?? "" : ""} readOnly className={inputClass} />
              </div>
              <div className="w-32">
                <span className="block text-xs text-ink-secondary">系数（1 成品消耗量）*</span>
                <input
                  value={l.qtyPerFinishedUnit}
                  onChange={(e) => updateLine(i, { qtyPerFinishedUnit: e.target.value })}
                  placeholder="如 0.05（吨）"
                  className={`${inputClass} tabular-nums`}
                />
                {fieldErrors["qty:" + l.key] ? <span className="text-xs text-status-danger-text">{fieldErrors["qty:" + l.key]}</span> : null}
              </div>
              <div className="w-28">
                <span className="block text-xs text-ink-secondary">损耗率 %</span>
                <input value={l.lossRate} onChange={(e) => updateLine(i, { lossRate: e.target.value })} className={`${inputClass} tabular-nums`} />
                {fieldErrors["loss:" + l.key] ? <span className="text-xs text-status-danger-text">{fieldErrors["loss:" + l.key]}</span> : null}
              </div>
              <button type="button" onClick={() => removeLine(i)} className="rounded-md border border-status-danger-border px-2 py-1 text-xs text-status-danger-text hover:bg-status-danger-bg/10">
                删除
              </button>
            </div>
          ))}
        </div>
        {fieldErrors.lines ? <p className="mt-2 text-xs text-status-danger-text">{fieldErrors.lines}</p> : null}
      </section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("bom", "create")}>
      <AppPage>
        <BomCreateForm />
      </AppPage>
    </PermissionGuard>
  );
}
