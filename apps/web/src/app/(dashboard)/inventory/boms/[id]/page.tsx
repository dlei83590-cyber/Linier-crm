"use client";

/**
 * BOM Detail — 配方详情页（P-4 Item Sourcing，ADR-0049 + UI-09 FE2.0 统一）
 *
 * 展示配方头 + 原料行（系数/损耗率/需求量公式）；动作：激活（DRAFT/ARCHIVED→ACTIVE，bom:approve）/ 编辑 / 删除（仅 DRAFT）。
 * UI-09：迁移至 EntityDetailWorkspace（Header + Status + Actions + Summary + Lines 统一结构）。
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityDetailWorkspace, ConfirmActionDialog } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useSession } from "@/lib/session-context";
import { useToast } from "@/components/ui/toast";
import { BUTTON_PRIMARY_CLASS } from "@/lib/ui-classes";

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
        <div className="border-border bg-surface shadow-elevation-sm rounded-lg border p-6">
          <p className="text-sm text-status-danger-text">加载配方失败：{loadError.message}</p>
          <Link href="/inventory/boms" className="text-brand-600 mt-3 inline-block text-sm hover:underline">
            返回配方列表
          </Link>
        </div>
      </AppPage>
    );
  }
  if (!detail) {
    return (
      <AppPage>
        <div className="border-border bg-surface shadow-elevation-sm rounded-lg border p-6 text-sm text-ink-muted">
          加载中…
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <EntityDetailWorkspace
        title={`配方详情 — ${detail.bomNo}`}
        description={`成品配方 · v${detail.bomVersion}${detail.isDefault ? " · 默认配方" : ""}`}
        backHref="/inventory/boms"
        status={detail.status}
        statusLabel={STATUS_LABELS[detail.status] ?? detail.status}
        statusTone={STATUS_TONE_MAP[detail.status]}
        actions={
          <>
            {["DRAFT", "ARCHIVED"].includes(detail.status) && canActivate ? (
              <button
                type="button"
                onClick={() => setConfirmActivate(true)}
                disabled={activating}
                className={BUTTON_PRIMARY_CLASS}
              >
                {activating ? "处理中…" : "激活配方"}
              </button>
            ) : null}
            {detail.status === "DRAFT" && canEdit ? (
              <Link
                href={`/inventory/boms/${id}/edit`}
                className="border-border text-ink-secondary rounded-md border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-canvas"
              >
                编辑
              </Link>
            ) : null}
            {detail.status === "DRAFT" && canDelete ? (
              <button
                type="button"
                onClick={() => setDeleting(true)}
                className="border-status-danger-border text-status-danger-text rounded-md border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-status-danger-bg/10"
              >
                删除
              </button>
            ) : null}
          </>
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem
              label="成品"
              value={detail.finishedItem ? `${detail.finishedItem.code ?? ""} ${detail.finishedItem.name ?? ""}`.trim() : null}
            />
            <InfoItem
              label="商品来源"
              value={detail.finishedItem?.sourcingType ? SOURCING_LABELS[detail.finishedItem.sourcingType] ?? detail.finishedItem.sourcingType : null}
            />
            <InfoItem label="版本" value={`v${detail.bomVersion}`} />
            <InfoItem label="备注" value={detail.remark} />
          </div>
        }
      >
        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">原料行（配方系数）</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="text-ink-secondary bg-canvas text-left text-xs font-medium">
                <tr>
                  <th className="px-4 py-2 font-semibold">原料</th>
                  <th className="px-4 py-2 font-semibold">单位</th>
                  <th className="px-4 py-2 text-right font-semibold">系数（1 成品消耗量）</th>
                  <th className="px-4 py-2 text-right font-semibold">损耗率</th>
                  <th className="px-4 py-2 text-right font-semibold">每 100 成品需求</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(detail.lines ?? []).map((l) => {
                  const per100 = Number(l.qtyPerFinishedUnit) * 100 * (1 + Number(l.lossRate || 0));
                  return (
                    <tr key={l.id}>
                      <td className="px-4 py-2">{`${l.componentItem?.code ?? ""} ${l.componentItem?.name ?? ""}`.trim() || "—"}</td>
                      <td className="px-4 py-2">{l.componentUom?.symbol ?? l.componentUom?.code ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{l.qtyPerFinishedUnit}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{Number(l.lossRate) > 0 ? `${(Number(l.lossRate) * 100).toFixed(2)}%` : "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{per100.toFixed(4)} {l.componentUom?.symbol ?? ""}</td>
                    </tr>
                  );
                })}
                {(detail.lines ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-muted">暂无原料行</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </EntityDetailWorkspace>

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
