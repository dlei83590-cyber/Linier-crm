"use client";

/**
 * Purchase Requisitions — 编辑采购申请（F2-3 Batch C1 Consolidation，CTO #11888 / FE 2.0 ui-08）
 *
 * 由旧式 CARD_CLASS 自绘表单迁移至统一 Workspace：
 * AppPage → EntityFormWorkspace → FormField → LineEditor。
 * - GET detail authoritative version；仅 DRAFT 可编辑（非 DRAFT 显示「当前状态不可编辑」+ 返回详情）
 * - PATCH 携带 version；lines 全量替换；needDate/remark 可选
 * - VERSION_CONFLICT 走 F2-2 统一 stale 面板（EntityFormWorkspace onReload：重新 GET → 更新 version → 成功后重置 dirty）
 * - 禁止 silent retry / 自动覆盖 / 自动重新 PATCH
 * - Dirty State 交 EntityFormWorkspace（不页面自挂 beforeunload / window.confirm）
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import {
  AppPage,
  EntityFormWorkspace,
  LineEditor,
  ErrorPanel,
  type LineColumn,
  type LineRow,
} from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface ItemOption {
  id: string;
  code: string | null;
  name: string | null;
  stockUom?: { id: string; code: string | null; symbol: string | null } | null;
}

interface RequisitionDetail {
  id: string;
  code: string;
  status: string;
  version: number;
  needDate?: string | null;
  remark?: string | null;
  lines?: Array<{
    id: string;
    lineNo: number;
    itemId: string | null;
    description: string;
    quantity: string;
    uomId?: string | null;
    needDate?: string | null;
    remark?: string | null;
  }>;
}

interface RequisitionLineRow extends LineRow {
  itemId: string;
  description: string;
  quantity: string;
  uomId: string;
  needDate: string;
  remark: string;
}

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  // 用户指令 2026-08-21：全站取消分钟格式 → date（YYYY-MM-DD）
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const inputClass = INPUT_CLASS;


function RequisitionEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  const [items, setItems] = useState<ItemOption[]>([]);

  const [detail, setDetail] = useState<RequisitionDetail | null>(null);
  const [notEditable, setNotEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);

  const [needDate, setNeedDate] = useState("");
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<RequisitionLineRow[]>([]);
  const [version, setVersion] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // 数据源：items 下拉
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<ItemOption[]>("/api/items?pageSize=100", { signal: controller.signal })
      .then((body) => setItems(body.data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载物料失败", "NETWORK_ERROR"));
      });
    return () => controller.abort();
  }, []);

  // 加载详情（Edit 回填 + version CAS 源）
  const loadDetail = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    apiFetch<RequisitionDetail>(`/api/purchase-requisitions/${id}`, { signal: controller.signal })
      .then((body) => {
        const d = body.data;
        setDetail(d);
        if (d.status !== "DRAFT") {
          setNotEditable(true);
          setLoading(false);
          return;
        }
        setNotEditable(false);
        setVersion(d.version);
        setNeedDate(toLocalInput(d.needDate));
        setRemark(d.remark ?? "");
        setLines(
          (d.lines ?? []).map((l) => ({
            id: crypto.randomUUID(),
            itemId: l.itemId ?? "",
            description: l.description,
            quantity: l.quantity,
            uomId: l.uomId ?? "",
            needDate: toLocalInput(l.needDate),
            remark: l.remark ?? "",
          })),
        );
        // 重新加载最新数据后：重置 dirty（reload 成功才清）
        setDirty(false);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载失败", "NETWORK_ERROR"));
        setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  useEffect(() => loadDetail(), [loadDetail]);

  // F2-2 UX Hardening ②：409 VERSION_CONFLICT 后重新加载最新数据（保持 dirty=true 直到 GET 成功）
  const handleReload = () => {
    setError(null);
    setReloadKey((k) => k + 1);
  };

  useEffect(() => {
    if (reloadKey === 0) return;
    return loadDetail();
  }, [reloadKey, loadDetail]);

  // 三层 validation（仅 UX 层；领域事实以服务端为准）
  const validate = (): string | null => {
    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i];
      if (!l.itemId) return `第 ${i + 1} 行：请选择物料`;
      const qty = Number(l.quantity);
      if (!l.quantity || !Number.isFinite(qty) || qty <= 0) return `第 ${i + 1} 行：数量必须大于 0`;
    }
    return null;
  };

  /** 行编辑：选商品自动带出 stockUom 作为行 UOM（契约内字段；服务端仍为准） */
  const handleLinesChange = (next: RequisitionLineRow[]) => {
    for (let i = 0; i < next.length; i += 1) {
      const prevRow = lines[i];
      const nextRow = next[i];
      if (!prevRow || !nextRow || prevRow.itemId === nextRow.itemId) continue;
      const item = items.find((it) => it.id === nextRow.itemId);
      if (item?.stockUom?.id) nextRow.uomId = item.stockUom.id;
    }
    setLines(next);
    setDirty(true);
  };

  const updateLine = (idx: number, patch: Partial<RequisitionLineRow>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  const handleSave = () => {
    if (submitting) return;
    const firstError = validate();
    if (firstError) {
      setError(new ApiClientError(400, firstError, "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    apiFetch<RequisitionDetail>(`/api/purchase-requisitions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version,
        ...(needDate ? { needDate: toIso(needDate) } : {}),
        ...(remark ? { remark } : {}),
        lines: lines.map((l) => ({
          itemId: l.itemId,
          ...(l.description ? { description: l.description } : {}),
          quantity: Number(l.quantity),
          ...(l.uomId ? { uomId: l.uomId } : {}),
          ...(l.needDate ? { needDate: toIso(l.needDate) } : {}),
          ...(l.remark ? { remark: l.remark } : {}),
        })),
      }),
    })
      .then(() => {
        setDirty(false);
        router.push(`/purchasing/requisitions/${id}`);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  const lineColumns: LineColumn<RequisitionLineRow>[] = [
    {
      key: "itemId",
      header: "物料 *",
      type: "select",
      options: items.map((i) => ({
        value: i.id,
        label: `${i.code ?? ""} · ${i.name ?? ""}`.trim(),
      })),
      placeholder: "请选择物料",
    },
    { key: "description", header: "需求描述", type: "text", placeholder: "可选" },
    { key: "quantity", header: "数量 *", type: "number", placeholder: "> 0" },
    {
      key: "uom",
      header: "单位",
      render: (row) => {
        const item = items.find((it) => it.id === row.itemId);
        return item?.stockUom?.symbol ?? "—";
      },
    },
    {
      key: "needDate",
      header: "需求日期",
      render: (row) => (
        <input
          type="date"
          value={row.needDate}
          onChange={(e) => {
            const idx = lines.findIndex((l) => l.id === row.id);
            updateLine(idx, { needDate: e.target.value });
          }}
          className={inputClass}
        />
      ),
    },
    { key: "remark", header: "备注", type: "text", placeholder: "可选" },
  ];

  if (loading) {
    return (
      <AppPage>
        <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-muted">
          加载中…
        </div>
      </AppPage>
    );
  }

  if (loadError) {
    return (
      <AppPage>
        <ErrorPanel error={loadError} />
      </AppPage>
    );
  }

  if (notEditable || !detail) {
    return (
      <AppPage>
        <div className="border-border bg-surface rounded-lg border p-6">
          <p className="text-ink-primary text-sm font-medium">当前状态不可编辑</p>
          <p className="text-ink-secondary mt-1 text-sm">
            仅草稿状态可编辑（当前状态：{detail?.status ?? "—"}）——已提交/已转单的采购申请不可修改。
          </p>
          <button
            type="button"
            onClick={() => router.push(`/purchasing/requisitions/${id}`)}
            className="bg-brand-600 hover:bg-brand-700 mt-3 rounded-md px-3 py-1.5 text-sm font-medium text-white"
          >
            返回详情
          </button>
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <EntityFormWorkspace
        title={`编辑采购申请 — ${detail.code}`}
        backHref={`/purchasing/requisitions/${id}`}
        mode="edit"
        submitting={submitting}
        error={error}
        dirty={dirty}
        onDirty={() => setDirty(true)}
        onReload={handleReload}
        onSave={handleSave}
        onCancel={() => router.push(`/purchasing/requisitions/${id}`)}
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">基本信息</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="单号">
              <span className="text-ink-primary border-border bg-canvas block rounded-md border px-3 py-1.5 text-sm">
                {detail.code}
              </span>
            </FormField>
            <FormField label="期望日期">
              <input
                type="date"
                value={needDate}
                onChange={(e) => {
                  setNeedDate(e.target.value);
                  setDirty(true);
                }}
                className={inputClass}
              />
            </FormField>
            <FormField label="备注">
              <textarea
                value={remark}
                onChange={(e) => {
                  setRemark(e.target.value);
                  setDirty(true);
                }}
                rows={2}
                maxLength={1000}
                className={inputClass}
              />
            </FormField>
          </div>
        </section>

        <LineEditor<RequisitionLineRow>
          columns={lineColumns}
          lines={lines}
          onChange={handleLinesChange}
          onAdd={() => ({
            id: crypto.randomUUID(),
            itemId: "",
            description: "",
            quantity: "",
            uomId: "",
            needDate: "",
            remark: "",
          })}
          addLabel="添加行"
          emptyMessage="请添加至少一行需求明细"
        />
      </EntityFormWorkspace>
    </AppPage>
  );
}

export default function Page() {
  const { state } = useSession();
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("purchase-requisition", "edit"));
  return (
    <PermissionGuard permission={PERMISSIONS.PURCHASE_REQUISITION_READ}>
      {canEdit ? (
        <RequisitionEditForm />
      ) : (
        <AppPage>
          <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-secondary">
            无编辑权限
          </div>
        </AppPage>
      )}
    </PermissionGuard>
  );
}
