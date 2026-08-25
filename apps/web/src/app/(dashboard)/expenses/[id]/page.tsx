"use client";

/**
 * Expenses — 报销申请详情（feat(crm) expense-analytics）
 *
 * 只读消费 GET /api/expenses/:id（ProjectExpense 事实 + Project → BusinessPartner 归属 + 申请人/审批人/驳回人）。
 * 报销流程（Migration 0051）：DRAFT/REJECTED → 提交(PENDING) → 批准(APPROVED) / 驳回(REJECTED)；
 * 复用 ProjectExpense.approvalStatus 枚举，不新增工作流模型。动作后刷新详情（version CAS 由服务端保证）。
 * FRT-09：DRAFT/REJECTED 详情直接提供「编辑/改稿」入口（复用 ProjectExpense PATCH，跳转 /expenses/:id/edit）。
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityDetailWorkspace, ErrorPanel, ReasonDialog } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useSession } from "@/lib/session-context";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { useToast } from "@/components/ui/toast";
import { PageLoading } from "@/components/ui/skeleton";
import { formatDate, formatDateOnly, formatMoney } from "@/lib/format";
import { validateRejectReason } from "@/lib/expenses/reject-reason";

interface ExpenseDetail {
  id: string;
  projectId: string;
  category: string;
  expenseType: string | null;
  expenseAttribution: string | null;
  amount: string;
  currency: string;
  incurredAt: string | null;
  note: string | null;
  approvalStatus: string;
  rejectionReason: string | null;
  version: number;
  createdAt: string;
  createdBy?: { id: string; name: string | null; email: string } | null;
  approvedBy?: { id: string; name: string | null; email: string } | null;
  rejectedBy?: { id: string; name: string | null; email: string } | null;
  project?: {
    id: string;
    code: string | null;
    name: string | null;
    stage: string | null;
    customer?: { id: string; code: string | null; name: string | null; type: string | null } | null;
  } | null;
}

const APPROVAL_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  PENDING: "待审批",
  APPROVED: "已批准",
  REJECTED: "已驳回",
};

const APPROVAL_TONE_MAP: Record<string, "neutral" | "info" | "success" | "danger"> = {
  DRAFT: "neutral",
  PENDING: "info",
  APPROVED: "success",
  REJECTED: "danger",
};

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function ExpenseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const id = typeof params.id === "string" ? params.id : "";
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canEdit = hasPermission(roles, actionPermission("project-expense", "edit"));
  const canApprove = hasPermission(roles, actionPermission("project-expense", "approve"));

  const [detail, setDetail] = useState<ExpenseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [acting, setActing] = useState(false);
  // 驳回原因 FormDialog（FE2.0 UI-10：替换 window.prompt，必填原因走 ReasonDialog）
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);

  const load = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<ExpenseDetail>("/api/expenses/" + id, { signal: controller.signal })
      .then((body) => setDetail(body.data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return controller;
  }, [id]);

  useEffect(() => {
    const controller = load();
    return () => controller.abort();
  }, [load]);

  const runAction = async (path: string, body: Record<string, unknown>, successMsg: string) => {
    if (acting) return;
    setActing(true);
    setError(null);
    try {
      await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
      toast.success(successMsg);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
    } finally {
      setActing(false);
    }
  };

  const handleSubmit = () => {
    if (!detail) return;
    runAction("/api/expenses/" + id + "/submit", { version: detail.version }, "已提交审批");
  };

  const handleApprove = () => {
    if (!detail) return;
    runAction("/api/expenses/" + id + "/approve", { version: detail.version }, "已批准");
  };

  /** 打开驳回原因对话框（原因校验在提交时执行，错误回显在对话框内） */
  const openReject = () => {
    if (!detail) return;
    setRejectReason("");
    setRejectError(null);
    setRejectOpen(true);
  };

  /** 提交驳回：先本地校验（与 POST /api/expenses/:id/reject zod 契约一致），失败留在对话框内 */
  const submitReject = () => {
    if (!detail || acting) return;
    const validationError = validateRejectReason(rejectReason);
    if (validationError) {
      setRejectError(validationError);
      return;
    }
    setActing(true);
    setError(null);
    apiFetch("/api/expenses/" + id + "/reject", {
      method: "POST",
      body: JSON.stringify({ version: detail.version, reason: rejectReason.trim() }),
    })
      .then(() => {
        setRejectOpen(false);
        setRejectReason("");
        toast.success("已驳回");
        load();
      })
      .catch((err: unknown) => {
        const e = err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR");
        setRejectError(e.message + (e.code ? "（" + e.code + "）" : ""));
        setActing(false);
      });
  };

  if (loading) {
    return (
      <AppPage>
        <div className="border-border bg-surface overflow-hidden rounded-lg border">
          <PageLoading rows={4} />
        </div>
      </AppPage>
    );
  }

  if (error || !detail) {
    return (
      <AppPage>
        <ErrorPanel error={error} />
        <Link href="/expenses" className="text-brand-600 mt-3 inline-block text-sm hover:underline">
          返回报销列表
        </Link>
      </AppPage>
    );
  }

  const customer = detail.project?.customer;
  const status = detail.approvalStatus;
  const showEdit = canEdit && (status === "DRAFT" || status === "REJECTED");
  const showSubmit = canEdit && (status === "DRAFT" || status === "REJECTED");
  const showApprove = canApprove && status === "PENDING";
  const showReject = canApprove && status === "PENDING";

  return (
    <AppPage>
      <EntityDetailWorkspace
        title={"报销申请 · " + (detail.project?.name ?? detail.projectId)}
        description="客户归属：项目 → 客户（BusinessPartner）；报销记录直接挂在项目下"
        backHref="/expenses"
        status={status}
        statusLabel={APPROVAL_LABELS[status] ?? status}
        statusTone={APPROVAL_TONE_MAP[status]}
        actions={
          <div className="flex items-center gap-2">
            {showEdit ? (
              <Link
                href={"/expenses/" + id + "/edit"}
                className={status === "REJECTED" ? BUTTON_PRIMARY_CLASS : BUTTON_SECONDARY_CLASS}
              >
                {status === "REJECTED" ? "改稿并重新提交" : "编辑"}
              </Link>
            ) : null}
            {showSubmit ? (
              <button type="button" onClick={handleSubmit} disabled={acting} className={BUTTON_PRIMARY_CLASS}>
                {acting ? "处理中…" : "提交审批"}
              </button>
            ) : null}
            {showApprove ? (
              <button type="button" onClick={handleApprove} disabled={acting} className={BUTTON_PRIMARY_CLASS}>
                {acting ? "处理中…" : "批准"}
              </button>
            ) : null}
            {showReject ? (
              <button type="button" onClick={openReject} disabled={acting} className={BUTTON_SECONDARY_CLASS}>
                {acting ? "处理中…" : "驳回"}
              </button>
            ) : null}
            <button type="button" onClick={() => router.push("/expenses")} className={BUTTON_SECONDARY_CLASS}>
              返回列表
            </button>
          </div>
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="客户" value={customer ? customer.name ?? customer.code ?? "—" : "—"} />
            <InfoItem
              label="项目"
              value={
                <Link href={"/projects/" + detail.projectId} className="text-brand-600 hover:underline">
                  {detail.project ? detail.project.name ?? detail.project.code ?? detail.projectId : detail.projectId}
                </Link>
              }
            />
            <InfoItem label="费用类型" value={detail.expenseType ?? "—"} />
            <InfoItem label="费用科目" value={detail.category} />
            <InfoItem label="费用归属" value={detail.expenseAttribution ?? "—"} />
            <InfoItem label="金额" value={formatMoney(detail.amount, detail.currency)} />
            <InfoItem label="发生日期" value={formatDateOnly(detail.incurredAt)} />
            <InfoItem label="项目阶段" value={detail.project?.stage ?? "—"} />
            <InfoItem
              label="申请人"
              value={detail.createdBy ? detail.createdBy.name ?? detail.createdBy.email : "—"}
            />
            <InfoItem
              label="审批人"
              value={detail.approvedBy ? detail.approvedBy.name ?? detail.approvedBy.email : "—"}
            />
            <InfoItem
              label="驳回人"
              value={detail.rejectedBy ? detail.rejectedBy.name ?? detail.rejectedBy.email : "—"}
            />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
          </div>
        }
      >
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink-primary">备注</h2>
          <p className="text-ink-primary whitespace-pre-wrap text-sm">{detail.note ?? "—"}</p>
        </section>
        {status === "REJECTED" ? (
          <section className="rounded-md border border-status-danger-border bg-status-danger-bg/40 p-4">
            <h2 className="mb-2 text-sm font-semibold text-status-danger-text">驳回原因</h2>
            <p className="text-status-danger-text whitespace-pre-wrap text-sm">{detail.rejectionReason ?? "—"}</p>
          </section>
        ) : null}
      </EntityDetailWorkspace>

      <ReasonDialog
        open={rejectOpen}
        title="驳回报销申请"
        description="驳回后申请人可改稿并重新提交；驳回原因必填（≤500 字）。"
        label="驳回原因"
        placeholder="请填写驳回原因"
        value={rejectReason}
        onChange={setRejectReason}
        maxLength={500}
        confirmLabel="确认驳回"
        tone="danger"
        busy={acting}
        error={rejectError}
        onConfirm={submitReject}
        onCancel={() => setRejectOpen(false)}
      />
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("project-expense", "view")}>
      <ExpenseDetailPage />
    </PermissionGuard>
  );
}
