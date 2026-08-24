"use client";

/**
 * ProductionOrder Detail — 生产/外协工单详情页（P-4 Item Sourcing，ADR-0049）
 *
 * 状态机：DRAFT → SUBMITTED → POSTED / CANCELLED。
 * 动作：提交（DRAFT→SUBMITTED）/ 过账（SUBMITTED→POSTED，同事务领料→成品+成本）/ 取消（DRAFT/SUBMITTED→CANCELLED）。
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, ErrorPanel, StatusBadge, ConfirmActionDialog } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useSession } from "@/lib/session-context";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatMoney } from "@/lib/format";

interface OrderDetail {
  id: string;
  orderNo: string;
  productionType: string;
  plannedQty: string;
  status: string;
  batchNo?: string | null;
  productionDate?: string | null;
  processingFee?: string | null;
  movementGroupId?: string | null;
  postedAt?: string | null;
  version: number;
  finishedItem?: { id: string; code: string | null; name: string | null; stockUomId?: string | null } | null;
  warehouse?: { id: string; code: string | null; name: string | null } | null;
  supplier?: { id: string; code: string | null; name: string | null } | null;
  bom?: { id: string; bomNo: string | null; bomVersion: number | null; status: string | null } | null;
  lines?: Array<{
    id: string;
    lineType: string;
    itemId: string;
    quantity: string;
    unitCost?: string | null;
    amount?: string | null;
    remark?: string | null;
    item?: { code: string | null; name: string | null } | null;
    uom?: { code: string | null; symbol: string | null } | null;
    warehouse?: { name: string | null } | null;
  }>;
}

const TYPE_LABELS: Record<string, string> = { SELF_MANUFACTURE: "自产", OEM_OUTSOURCING: "OEM 外协" };
const STATUS_LABELS: Record<string, string> = { DRAFT: "草稿", SUBMITTED: "已提交", POSTED: "已过账", CANCELLED: "已取消" };
const STATUS_TONE_MAP: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  POSTED: "success",
  CANCELLED: "danger",
};

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-ink-secondary">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-ink-primary">{value ?? "—"}</div>
    </div>
  );
}

type ConfirmAction = "submit" | "post" | "cancel" | "delete" | null;

function OrderDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const toast = useToast();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];

  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmAction>(null);

  const load = () => {
    apiFetch<OrderDetail>(`/api/production-orders/${id}`)
      .then((body) => setDetail(body.data))
      .catch((err: unknown) =>
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载工单失败", "NETWORK_ERROR")),
      );
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canEdit = hasPermission(roles, actionPermission("production-order", "edit"));
  const canDelete = hasPermission(roles, actionPermission("production-order", "delete"));
  const canClose = hasPermission(roles, actionPermission("production-order", "close"));

  const runAction = async (action: Exclude<ConfirmAction, null>) => {
    if (!detail || busy) return;
    setBusy(true);
    try {
      if (action === "delete") {
        await apiFetch(`/api/production-orders/${id}`, { method: "DELETE" });
        toast.success("工单已删除");
        router.push("/inventory/production-orders");
        return;
      }
      await apiFetch(`/api/production-orders/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ version: detail.version }),
      });
      toast.success(action === "post" ? "工单已过账（领料出库 → 成品入库）" : action === "submit" ? "工单已提交" : "工单已取消");
      setConfirm(null);
      load();
    } catch (err) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "操作失败", "NETWORK_ERROR");
      toast.error("操作失败", e.message);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <AppPage>
        <ErrorPanel error={loadError} />
      </AppPage>
    );
  }
  if (!detail) {
    return (
      <AppPage>
        <div className="text-sm text-ink-muted">加载中…</div>
      </AppPage>
    );
  }

  const confirmMeta: Record<string, { title: string; desc: string; tone: "primary" | "danger"; label: string }> = {
    submit: {
      title: "提交工单「" + detail.orderNo + "」？",
      desc: "提交确认（SUBMITTED ≠ POSTED）；过账前仍可取消。",
      tone: "primary",
      label: "确认提交",
    },
    post: {
      title: "过账工单「" + detail.orderNo + "」？",
      desc: "过账为不可逆事实：同事务领料出库 → 成品入库，成本 = Σ原料成本 + 加工费。请确认原料库存充足。",
      tone: "primary",
      label: "确认过账",
    },
    cancel: {
      title: "取消工单「" + detail.orderNo + "」？",
      desc: "取消后工单不可再提交/过账（已过账工单不可取消）。",
      tone: "danger",
      label: "确认取消",
    },
    delete: {
      title: "删除工单「" + detail.orderNo + "」？",
      desc: "仅草稿状态可删除。",
      tone: "danger",
      label: "确认删除",
    },
  };

  return (
    <AppPage maxWidth="6xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-ink-primary">{detail.orderNo}</h1>
              <StatusBadge status={detail.status} label={STATUS_LABELS[detail.status] ?? detail.status} toneMap={STATUS_TONE_MAP} />
              <span className="rounded bg-canvas px-2 py-0.5 text-xs text-ink-secondary">
                {TYPE_LABELS[detail.productionType] ?? detail.productionType}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-secondary">生产/外协工单</p>
          </div>
          <div className="flex items-center gap-2">
            {detail.status === "DRAFT" && canEdit && (
              <button
                type="button"
                onClick={() => setConfirm("submit")}
                disabled={busy}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                提交
              </button>
            )}
            {detail.status === "SUBMITTED" && canEdit && (
              <button
                type="button"
                onClick={() => setConfirm("post")}
                disabled={busy}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                过账（领料→入库）
              </button>
            )}
            {["DRAFT", "SUBMITTED"].includes(detail.status) && canClose && (
              <button
                type="button"
                onClick={() => setConfirm("cancel")}
                disabled={busy}
                className="rounded-md border border-status-danger-border px-4 py-2 text-sm text-status-danger-text hover:bg-status-danger-bg/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                取消
              </button>
            )}
            {detail.status === "DRAFT" && canDelete && (
              <button
                type="button"
                onClick={() => setConfirm("delete")}
                disabled={busy}
                className="rounded-md border border-status-danger-border px-4 py-2 text-sm text-status-danger-text hover:bg-status-danger-bg/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                删除
              </button>
            )}
          </div>
        </div>

        <section className="rounded-md border border-border p-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="成品" value={detail.finishedItem ? `${detail.finishedItem.code ?? ""} ${detail.finishedItem.name ?? ""}`.trim() : null} />
            <InfoItem label="产出数量" value={detail.plannedQty} />
            <InfoItem label="成品仓库" value={detail.warehouse?.name} />
            <InfoItem label="配方" value={detail.bom?.bomNo ? `${detail.bom.bomNo}（v${detail.bom.bomVersion}）` : "手工工单"} />
            <InfoItem label="外协厂（OEM）" value={detail.supplier?.name} />
            <InfoItem label="加工费" value={detail.processingFee != null ? formatMoney(detail.processingFee, "CNY") : null} />
            <InfoItem label="批次" value={detail.batchNo} />
            <InfoItem label="完工日期" value={formatDate(detail.productionDate)} />
            {detail.status === "POSTED" ? (
              <>
                <InfoItem label="过账时间" value={formatDate(detail.postedAt)} />
                <InfoItem label="库存流水组" value={detail.movementGroupId ? detail.movementGroupId.slice(0, 8) + "…" : null} />
              </>
            ) : null}
          </div>
        </section>

        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-primary">工单行</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="text-ink-secondary bg-canvas text-left text-xs font-medium">
                <tr>
                  <th className="px-4 py-2 font-semibold">类型</th>
                  <th className="px-4 py-2 font-semibold">物料</th>
                  <th className="px-4 py-2 font-semibold">单位</th>
                  <th className="px-4 py-2 font-semibold">数量</th>
                  <th className="px-4 py-2 font-semibold">仓库</th>
                  <th className="px-4 py-2 font-semibold">单位成本</th>
                  <th className="px-4 py-2 font-semibold">金额</th>
                  <th className="px-4 py-2 font-semibold">备注</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(detail.lines ?? []).map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${l.lineType === "MATERIAL" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                        {l.lineType === "MATERIAL" ? "领料" : "成品"}
                      </span>
                    </td>
                    <td className="px-4 py-2">{`${l.item?.code ?? ""} ${l.item?.name ?? ""}`.trim() || "—"}</td>
                    <td className="px-4 py-2">{l.uom?.symbol ?? "—"}</td>
                    <td className="px-4 py-2 tabular-nums">{l.quantity}</td>
                    <td className="px-4 py-2">{l.warehouse?.name ?? "—"}</td>
                    <td className="px-4 py-2 tabular-nums">{l.unitCost != null ? l.unitCost : "—"}</td>
                    <td className="px-4 py-2 tabular-nums">{l.amount != null ? l.amount : "—"}</td>
                    <td className="px-4 py-2 text-ink-muted">{l.remark ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <Link href="/inventory/production-orders" className="text-sm text-brand-600 hover:underline">
          ← 返回工单列表
        </Link>
      </div>

      {confirm ? (
        <ConfirmActionDialog
          open={confirm !== null}
          title={confirmMeta[confirm].title}
          description={confirmMeta[confirm].desc}
          confirmLabel={confirmMeta[confirm].label}
          tone={confirmMeta[confirm].tone}
          busy={busy}
          onConfirm={() => runAction(confirm)}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("production-order", "view")}>
      <OrderDetailPage />
    </PermissionGuard>
  );
}
