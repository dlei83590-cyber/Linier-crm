"use client";

/**
 * BOM Edit — 编辑物料配方（P-4 Item Sourcing，ADR-0049 + UI-09 FE2.0 表单统一）
 *
 * 契约：PATCH /api/boms/:id（仅 DRAFT，CAS version，行整体重建）。
 *
 * UI-09：迁移至 EntityFormWorkspace（Dirty-State Guard / 409 冲突面板 / ErrorPanel /
 * 统一 Save/Cancel），移除页面级 window.confirm。
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  stockUom?: { id: string; code: string | null; symbol: string | null } | null;
}

interface BomLineForm {
  key: string;
  componentItemId: string;
  componentUomId: string;
  qtyPerFinishedUnit: string;
  lossRate: string;
}

interface BomDetail {
  id: string;
  bomNo: string;
  bomVersion: number;
  status: string;
  isDefault: boolean;
  remark?: string | null;
  version: number;
  finishedItemId: string;
  finishedItem?: { code: string | null; name: string | null } | null;
  lines?: Array<{
    id: string;
    componentItemId: string;
    componentUomId: string;
    qtyPerFinishedUnit: string;
    lossRate: string;
    componentItem?: { code: string | null; name: string | null } | null;
  }>;
}

const inputClass = INPUT_CLASS;

function BomEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  const [items, setItems] = useState<ItemOption[]>([]);
  const [finishedItemId, setFinishedItemId] = useState("");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<BomLineForm[]>([]);
  const [version, setVersion] = useState(0);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback((): (() => void) => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<BomDetail>(`/api/boms/${id}`, { signal: controller.signal }),
      apiFetch<ItemOption[]>("/api/items?pageSize=200", { signal: controller.signal }),
    ])
      .then(([bomBody, itemBody]) => {
        const d = bomBody.data;
        if (d.status !== "DRAFT") {
          setLoadError(new ApiClientError(409, "仅草稿状态的配方可编辑", "INVALID_STATE"));
          setLoadFailed(true);
          return;
        }
        setFinishedItemId(d.finishedItemId);
        setRemark(d.remark ?? "");
        setLines(
          (d.lines ?? []).map((l) => ({
            key: l.id,
            componentItemId: l.componentItemId,
            componentUomId: l.componentUomId,
            qtyPerFinishedUnit: l.qtyPerFinishedUnit,
            lossRate: l.lossRate,
          })),
        );
        setVersion(d.version);
        setItems(Array.isArray(itemBody.data) ? itemBody.data : []);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载配方失败", "NETWORK_ERROR"));
        setLoadFailed(true);
      });
    return () => controller.abort();
  }, [id]);

  useEffect(() => load(), [load]);

  const markDirty = () => setDirty(true);

  const updateLine = (index: number, patch: Partial<BomLineForm>) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    markDirty();
  };

  const handleComponentChange = (index: number, itemId: string) => {
    const item = items.find((it) => it.id === itemId);
    updateLine(index, { componentItemId: itemId, componentUomId: item?.stockUom?.id ?? "" });
  };

  const addLine = () => {
    setLines((prev) => [...prev, { key: crypto.randomUUID(), componentItemId: "", componentUomId: "", qtyPerFinishedUnit: "", lossRate: "0" }]);
    markDirty();
  };
  const removeLine = (index: number) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
    markDirty();
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const errs: Record<string, string> = {};
    const validLines = lines.filter((l) => l.componentItemId);
    if (validLines.length === 0) errs.lines = "至少需要一行原料";
    for (const l of validLines) {
      if (!l.qtyPerFinishedUnit || Number(l.qtyPerFinishedUnit) <= 0) errs["qty:" + l.key] = "系数必须大于 0";
      if (l.lossRate !== "" && (Number(l.lossRate) < 0 || Number(l.lossRate) >= 1)) errs["loss:" + l.key] = "损耗率必须在 [0, 1)";
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/boms/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          version,
          remark: remark.trim() || null,
          lines: validLines.map((l) => ({
            componentItemId: l.componentItemId,
            componentUomId: l.componentUomId,
            qtyPerFinishedUnit: Number(l.qtyPerFinishedUnit),
            lossRate: l.lossRate === "" ? 0 : Number(l.lossRate),
          })),
        }),
      });
      router.push(`/inventory/boms/${id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
      setSubmitting(false);
    }
  };

  if (loadFailed) {
    return (
      <AppPage>
        <div className="border-border bg-surface shadow-elevation-sm rounded-lg border p-6">
          <p className="text-sm text-status-danger-text">{loadError?.message ?? "加载配方失败"}</p>
          <a href={`/inventory/boms/${id}`} className="text-brand-600 mt-3 inline-block text-sm hover:underline">
            返回详情
          </a>
        </div>
      </AppPage>
    );
  }

  return (
    <EntityFormWorkspace
      title="编辑物料配方"
      description="配方成品不可更换，仅可调整原料行与系数（仅 DRAFT 可编辑，version CAS）。"
      backHref={`/inventory/boms/${id}`}
      mode="edit"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onReload={() => {
        setError(null);
        setLoadFailed(false);
        load();
      }}
      onSave={handleSubmit}
      onCancel={() => router.push(`/inventory/boms/${id}`)}
      saveLabel="保存配方"
    >
      <section className="rounded-md border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-primary">配方信息</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                <input value={l.qtyPerFinishedUnit} onChange={(e) => updateLine(i, { qtyPerFinishedUnit: e.target.value })} className={`${inputClass} tabular-nums`} />
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
    <PermissionGuard permission={actionPermission("bom", "edit")}>
      <AppPage>
        <BomEditForm />
      </AppPage>
    </PermissionGuard>
  );
}