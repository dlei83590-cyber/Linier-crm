"use client";

/**
 * Purchase Requisitions — 新建采购申请（F2-3 Batch C1 Consolidation，CTO #11888 / FE 2.0 ui-08）
 *
 * 由旧式 CARD_CLASS 自绘表单迁移至统一 Workspace：
 * AppPage → EntityFormWorkspace → FormField → LineEditor。
 * - 数据源：items（GET /api/items FINAL read API，统一 envelope）
 * - needDate/remark 可选；lines 每行 itemId 必填、quantity > 0；UOM 随物料自动带出（stockUom）
 * - 服务端生成 canonical id 后导航；不客户端提交总金额
 * - Dirty State 交 EntityFormWorkspace（不页面自挂 beforeunload / window.confirm）
 * - 权限用 shared constant（PERMISSIONS / actionPermission），不复制裸字符串
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import {
  AppPage,
  EntityFormWorkspace,
  LineEditor,
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

interface RequisitionLineRow extends LineRow {
  itemId: string;
  description: string;
  quantity: string;
  uomId: string;
  needDate: string;
  remark: string;
}

const emptyLine = (withToday: boolean): RequisitionLineRow => ({
  id: crypto.randomUUID(),
  itemId: "",
  description: "",
  quantity: "",
  uomId: "",
  needDate: withToday ? todayInput() : "",
  remark: "",
});

/** 本地今日 YYYY-MM-DD（date 输入默认值；用户指令 2026-08-21：全站日期默认今天） */
function todayInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const inputClass = INPUT_CLASS;


function RequisitionCreateForm() {
  const router = useRouter();

  const [items, setItems] = useState<ItemOption[]>([]);

  const [needDate, setNeedDate] = useState(todayInput);
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<RequisitionLineRow[]>([emptyLine(true)]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  // 数据源：items 下拉（GET /api/items FINAL read API）
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<ItemOption[]>("/api/items?pageSize=100", { signal: controller.signal })
      .then((body) => setItems(body.data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载物料失败", "NETWORK_ERROR"));
      });
    return () => controller.abort();
  }, []);

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
    apiFetch<{ id: string; code: string }>("/api/purchase-requisitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      .then((body) => {
        setDirty(false);
        router.push(`/purchasing/requisitions/${body.data.id}`);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "创建失败", "NETWORK_ERROR"));
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

  return (
    <EntityFormWorkspace
      title="新建采购申请"
      description="创建采购申请（DRAFT）"
      backHref="/purchasing/requisitions"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/purchasing/requisitions")}
      saveLabel="创建（草稿）"
    >
      <section className="border-border rounded-md border p-4">
        <h2 className="text-ink-primary mb-3 text-sm font-semibold">基本信息</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
        onAdd={() => emptyLine(false)}
        addLabel="添加行"
        emptyMessage="请添加至少一行需求明细"
      />
    </EntityFormWorkspace>
  );
}

export default function Page() {
  const { state } = useSession();
  const canCreate =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("purchase-requisition", "create"));
  return (
    <PermissionGuard permission={PERMISSIONS.PURCHASE_REQUISITION_READ}>
      {canCreate ? (
        <AppPage>
          <RequisitionCreateForm />
        </AppPage>
      ) : (
        <AppPage>
          <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-secondary">
            无创建权限
          </div>
        </AppPage>
      )}
    </PermissionGuard>
  );
}