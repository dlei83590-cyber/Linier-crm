"use client";

/**
 * BOM Detail — 配方详情页（P-4 Item Sourcing，ADR-0049）
 *
 * 展示配方头 + 原料行（系数/损耗率/需求量公式）；动作：激活（DRAFT/ARCHIVED→ACTIVE，bom:approve）/ 编辑 / 删除（仅 DRAFT）。
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

interface BomDetail {
  id: string;
  bomNo: string;
  bomVersion: number;
  status: string;
  isDefault: boolean;
  remark?: string | null;
  version: number;
  finishedItem?: { id: string; code: string | null; name: string | null; model: string | null; sourcingType?: string | null } | null;
  lines?: Array<{
    id: string;
    componentItemId: string;
    componentUomId: string;
    qtyPerFinishedUnit: string;
    lossRate: string;
    sort: number;
    componentItem?: { code: string | null; name: string | null; model: string | null } | null;
    componentUom?: { code: string | null; symbol: string | null } | null;
  }>;
}

const STATUS_LABELS: Record<string, string> = { DRAFT: "草稿", ACTIVE: "生效", ARCHIVED: "归档" };
const STATUS_TONE_MAP: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  ARCHIVED: "warning",
};
const SOURCING_LABELS: Record<string, string> = {
  BOUGHT: "外购",
  SELF_MANUFACTURED: "自产",
  OEM_OUTSOURCED: "OEM 外协",
};

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-ink-secondary">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-ink-primary">{value ?? "—"}</div>
    </div>
  );
}

function BomDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const toast = useToast();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];

  const [detail, setDetail] = useState<BomDetail | null>(null);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [activating, setActivating] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = () => {
    apiFetch<BomDetail>(`/api/boms/${id}`)
      .then((body) => setDetail(body.data))
      .catch((err: unknown) =>
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载配方失败", "NETWORK_ERROR")),
      );
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canActivate = hasPermission(roles, actionPermission("bom", "approve"));
  const canEdit = hasPermission(roles, actionPermission("bom", "edit"));
  const canDelete = hasPermission(roles, actionPermission("bom", "delete"));

  const runActivate = async () => {
    if (!detail || activating) return;
    setActivating(true);
    try {
      await apiFetch(`/api/boms/${id}/activate`, {
        method: "POST",
        body: JSON.stringify({ version: detail.version }),
      });
      toast.success("配方已生效");
      setConfirmActivate(false);
      load();
    } catch (err) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "激活失败", "NETWORK_ERROR");
      toast.error("激活失败", e.message);
      setConfirmActivate(false);
    } finally {
      setActivating(false);
    }
  };

  const runDelete = async () => {
    if (!detail || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch(`/api/boms/${id}`, { method: "DELETE" });
      toast.success("配方已删除");
      router.push("/inventory/boms");
    } catch (err) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "删除失败", "NETWORK_ERROR");
      toast.error("删除失败", e.message);
      setDeleting(false);
    } finally {
      setDeleteBusy(false);
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

  return (
    <AppPage maxWidth="6xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-ink-primary">{detail.bomNo}</h1>
              <StatusBadge status={detail.status} label={STATUS_LABELS[detail.status] ?? detail.status} toneMap={STATUS_TONE_MAP} />
              {detail.isDefault ? (
                <span className="rounded bg-brand-50 px-2 py-0.5 text-xs text-brand-700">默认配方</span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-ink-secondary">成品配方 · v{detail.bomVersion}</p>
          </div>
          <div className="flex items-center gap-2">
            {["DRAFT", "ARCHIVED"].includes(detail.status) && canActivate && (
              <button
                type="button"
                onClick={() => setConfirmActivate(true)}
                disabled={activating}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                激活配方
              </button>
            )}
            {detail.status === "DRAFT" && canEdit && (
              <Link href={`/inventory/boms/${id}/edit`} className="rounded-md border border-border px-4 py-2 text-sm text-ink-primary hover:bg-canvas">
                编辑
              </Link>
            )}
            {detail.status === "DRAFT" && canDelete && (
              <button
                type="button"
                onClick={() => setDeleting(true)}
                className="rounded-md border border-status-danger-border px-4 py-2 text-sm text-status-danger-text hover:bg-status-danger-bg/10"
              >
                删除
              </button>
            )}
          </div>
        </div>

        <section className="rounded-md border border-border p-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="成品" value={detail.finishedItem ? `${detail.finishedItem.code ?? ""} ${detail.finishedItem.name ?? ""}`.trim() : null} />
            <InfoItem label="商品来源" value={detail.finishedItem?.sourcingType ? SOURCING_LABELS[detail.finishedItem.sourcingType] ?? detail.finishedItem.sourcingType : null} />
            <InfoItem label="版本" value={`v${detail.bomVersion}`} />
            <InfoItem label="备注" value={detail.remark} />
          </div>
        </section>

        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-primary">原料行（配方系数）</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="text-ink-secondary bg-canvas text-left text-xs font-medium">
                <tr>
                  <th className="px-4 py-2 font-semibold">原料</th>
                  <th className="px-4 py-2 font-semibold">单位</th>
                  <th className="px-4 py-2 font-semibold">系数（1 成品消耗量）</th>
                  <th className="px-4 py-2 font-semibold">损耗率</th>
                  <th className="px-4 py-2 font-semibold">每 100 成品需求</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(detail.lines ?? []).map((l) => {
                  const per100 = Number(l.qtyPerFinishedUnit) * 100 * (1 + Number(l.lossRate || 0));
                  return (
                    <tr key={l.id}>
                      <td className="px-4 py-2">{`${l.componentItem?.code ?? ""} ${l.componentItem?.name ?? ""}`.trim() || "—"}</td>
                      <td className="px-4 py-2">{l.componentUom?.symbol ?? l.componentUom?.code ?? "—"}</td>
                      <td className="px-4 py-2 tabular-nums">{l.qtyPerFinishedUnit}</td>
                      <td className="px-4 py-2 tabular-nums">{Number(l.lossRate) > 0 ? `${(Number(l.lossRate) * 100).toFixed(2)}%` : "—"}</td>
                      <td className="px-4 py-2 tabular-nums text-ink-secondary">{per100.toFixed(4)} {l.componentUom?.symbol ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <Link href="/inventory/boms" className="text-sm text-brand-600 hover:underline">
          ← 返回配方列表
        </Link>
      </div>

      <ConfirmActionDialog
        open={confirmActivate}
        title={"激活配方「" + detail.bomNo + "」？"}
        description="激活后成为该成品当前生效配方（同成品其他生效配方自动归档）；生产/外协工单将引用本配方计算领料量。"
        confirmLabel="确认激活"
        tone="primary"
        busy={activating}
        onConfirm={runActivate}
        onCancel={() => setConfirmActivate(false)}
      />
      <ConfirmActionDialog
        open={deleting}
        title={"删除配方「" + detail.bomNo + "」？"}
        description="仅草稿状态可删除；删除后列表不再展示。"
        confirmLabel="确认删除"
        tone="danger"
        busy={deleteBusy}
        onConfirm={runDelete}
        onCancel={() => setDeleting(false)}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("bom", "view")}>
      <BomDetailPage />
    </PermissionGuard>
  );
}
