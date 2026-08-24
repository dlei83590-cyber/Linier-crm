"use client";

/**
 * BOM Edit — 编辑物料配方（P-4 Item Sourcing，ADR-0049）
 *
 * 契约：PATCH /api/boms/:id（仅 DRAFT，CAS version，行整体重建）。
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, ErrorPanel } from "@/components/workspace";
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

  useEffect(() => {
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

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

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
        <ErrorPanel error={loadError} />
      </AppPage>
    );
  }

  return (
    <AppPage maxWidth="6xl">
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">编辑物料配方</h1>
          <p className="mt-1 text-sm text-ink-secondary">成品 {finishedItemId ? "已锁定" : ""}（配方成品不可更换，仅可调整原料行与系数）</p>
        </div>

        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-primary">配方信息</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <span className="block text-xs text-ink-secondary">备注</span>
              <input value={remark} onChange={(e) => { setRemark(e.target.value); markDirty(); }} className={inputClass} />
            </label>
          </div>
        </section>

        <section className="rounded-md border border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-primary">原料行（配方系数）</h2>
            <button type="button" onClick={addLine} className="rounded-md border border-border px-3 py-1 text-xs text-ink-primary hover:bg-canvas">
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
                  <input value={l.qtyPerFinishedUnit} onChange={(e) => updateLine(i, { qtyPerFinishedUnit: e.target.value })} className={inputClass} />
                  {fieldErrors["qty:" + l.key] ? <span className="text-xs text-status-danger-text">{fieldErrors["qty:" + l.key]}</span> : null}
                </div>
                <div className="w-28">
                  <span className="block text-xs text-ink-secondary">损耗率 %</span>
                  <input value={l.lossRate} onChange={(e) => updateLine(i, { lossRate: e.target.value })} className={inputClass} />
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

        {error ? (
          <div className="border-status-danger-border rounded-md border bg-status-danger-bg/10 p-3 text-sm text-status-danger-text">
            {error.message}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => router.push(`/inventory/boms/${id}`)} className="rounded-md border border-border px-4 py-2 text-sm text-ink-primary hover:bg-canvas">
            取消
          </button>
          <button type="button" onClick={handleSubmit} disabled={submitting} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40">
            {submitting ? "保存中…" : "保存配方"}
          </button>
        </div>
      </div>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("bom", "edit")}>
      <BomEditForm />
    </PermissionGuard>
  );
}
