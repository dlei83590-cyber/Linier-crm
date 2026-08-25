"use client";

/**
 * Expenses — 报销申请详情（feat(crm) expense-analytics）
 *
 * 只读消费 GET /api/expenses/:id（ProjectExpense 事实 + Project → BusinessPartner 归属 + 申请人/审批人/驳回人）。
 * 报销流程（Migration 0051）：DRAFT/REJECTED → 提交(PENDING) → 批准(APPROVED) / 驳回(REJECTED)；
 * 复用 ProjectExpense.approvalStatus 枚举，不新增工作流模型。动作后刷新详情（version CAS 由服务端保证）。
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useSession } from "@/lib/session-context";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatDateOnly, formatMoney } from "@/lib/format";

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

  const handleReject = () => {
    if (!detail) return;
    const reason = window.prompt("请输入驳回原因（必填）");
    if (reason === null) return; // 取消
    if (!reason.trim()) {
      setError(new ApiClientError(400, "驳回必须提供原因", "EXPENSE_REJECT_REASON_REQUIRED"));
      return;
    }
    runAction(
      "/api/expenses/" + id + "/reject",
      { version: detail.version, reason: reason.trim() },
      "已驳回",
    );
  };

  if (loading) {
    return (
      <AppPage>
        <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-muted">
          加载中…
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
              <button type="button" onClick={handleReject} disabled={acting} className={BUTTON_SECONDARY_CLASS}>
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
          <section className="rounded-md border border-rose-200 bg-rose-50 p-4">
            <h2 className="mb-2 text-sm font-semibold text-rose-700">驳回原因</h2>
            <p className="text-rose-700 whitespace-pre-wrap text-sm">{detail.rejectionReason ?? "—"}</p>
          </section>
        ) : null}
      </EntityDetailWorkspace>
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
