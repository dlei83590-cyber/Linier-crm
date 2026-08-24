"use client";

/**
 * Expenses — 报销申请详情（feat(crm) 报销申请 MVP）
 *
 * 只读消费 GET /api/expenses/:id（ProjectExpense 事实 + Project → BusinessPartner 归属）。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate, formatDateOnly, formatMoney } from "@/lib/format";

interface ExpenseDetail {
  id: string;
  projectId: string;
  category: string;
  amount: string;
  currency: string;
  incurredAt: string | null;
  note: string | null;
  approvalStatus: string;
  createdAt: string;
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
  SUBMITTED: "已提交",
  APPROVED: "已批准",
  REJECTED: "已拒绝",
};

const APPROVAL_TONE_MAP: Record<string, "neutral" | "info" | "success" | "danger"> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
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
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<ExpenseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
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
    return () => controller.abort();
  }, [id]);

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
  return (
    <AppPage>
      <EntityDetailWorkspace
        title={"报销申请 · " + (detail.project?.name ?? detail.projectId)}
        description="客户归属：项目 → 客户（BusinessPartner）——报销记录直接挂在项目下"
        backHref="/expenses"
        status={detail.approvalStatus}
        statusLabel={APPROVAL_LABELS[detail.approvalStatus] ?? detail.approvalStatus}
        statusTone={APPROVAL_TONE_MAP[detail.approvalStatus]}
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
            <InfoItem label="费用科目" value={detail.category} />
            <InfoItem label="金额" value={formatMoney(detail.amount, detail.currency)} />
            <InfoItem label="发生日期" value={formatDateOnly(detail.incurredAt)} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem label="项目阶段" value={detail.project?.stage ?? "—"} />
          </div>
        }
      >
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink-primary">备注</h2>
          <p className="text-ink-primary whitespace-pre-wrap text-sm">{detail.note ?? "—"}</p>
        </section>
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
