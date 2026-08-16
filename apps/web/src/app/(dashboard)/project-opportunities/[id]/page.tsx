"use client";

/**
 * Project Opportunities — 项目机会详情页（F2-4A CRM/Project Workspace，CTO #11974）
 *
 * 依据 Contract Card（project-opportunities.md）：backend CRUD FINAL + convert。
 * 结构：AppPage + EntityDetailWorkspace（Header Summary → Status → Actions → Sections）。
 * 不改 backend / 状态机 / action；convert（Tier 3 factAction）保持 HOLD。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

interface OpportunityDetail {
  id: string;
  code: string;
  name: string;
  stage: string;
  customerInvestment: string | null;
  expectedRevenue: string | null;
  expectedCost: string | null;
  grossProfit: string | null;
  expenseBudget: string | null;
  salesTarget: string | null;
  paymentStatus: string;
  successProbability: string | null;
  ownerId: string | null;
  description: string | null;
  convertedAt: string | null;
  convertedBy: string | null;
  createdAt: string;
  customer?: { id: string; code: string | null; name: string | null; type: string | null } | null;
  project?: { id: string; code: string | null; name: string | null; stage: string | null } | null;
}

const STAGE_LABELS: Record<string, string> = {
  LEAD: "线索",
  QUALIFIED: "准入",
  SOLUTION: "方案",
  QUOTATION: "报价",
  SAMPLING: "试样",
  TESTING: "测试",
  SMALL_BATCH: "小批量",
  MASS_SUPPLY: "批量供货",
  PAUSED: "暂停",
  FAILED: "失败",
  CLOSED: "结项",
};

const STAGE_TONE_MAP: Record<string, "success" | "neutral" | "warning" | "danger" | "info"> = {
  LEAD: "neutral",
  QUALIFIED: "info",
  SOLUTION: "info",
  QUOTATION: "warning",
  SAMPLING: "neutral",
  TESTING: "warning",
  SMALL_BATCH: "warning",
  MASS_SUPPLY: "success",
  PAUSED: "warning",
  FAILED: "danger",
  CLOSED: "neutral",
};

const PAYMENT_LABELS: Record<string, string> = {
  UNPAID: "未回款",
  PARTIAL: "部分回款",
  PAID: "已回款",
  OVERDUE: "逾期",
};

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function OpportunityDetailPage() {
  const { state } = useSession();
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("project-opportunity", "edit"));
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<OpportunityDetail>(`/api/project-opportunities/${id}`, { signal: controller.signal })
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
        <Link href="/project-opportunities" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          返回列表
        </Link>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <EntityDetailWorkspace
        title={`项目机会详情 — ${detail.code}`}
        backHref="/project-opportunities"
        status={detail.stage}
        statusLabel={STAGE_LABELS[detail.stage] ?? detail.stage}
        statusTone={STAGE_TONE_MAP[detail.stage] ?? "neutral"}
        actions={
          canEdit ? (
            <Link
              href={`/project-opportunities/${id}/edit`}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              编辑
            </Link>
          ) : undefined
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="机会编号" value={detail.code} />
            <InfoItem label="机会名称" value={detail.name} />
            <InfoItem label="客户" value={detail.customer?.name} />
            <InfoItem label="客户类型" value={detail.customer?.type} />
            <InfoItem label="预计营收" value={detail.expectedRevenue} />
            <InfoItem label="预计成本" value={detail.expectedCost} />
            <InfoItem label="毛利" value={detail.grossProfit} />
            <InfoItem
              label="成功率"
              value={detail.successProbability != null ? `${detail.successProbability}%` : null}
            />
            <InfoItem label="回款状态" value={PAYMENT_LABELS[detail.paymentStatus] ?? detail.paymentStatus} />
            <InfoItem label="费用预算" value={detail.expenseBudget} />
            <InfoItem label="销售目标" value={detail.salesTarget} />
            <InfoItem label="客户投入" value={detail.customerInvestment} />
            <InfoItem label="负责人" value={detail.ownerId} />
            <InfoItem
              label="已转项目"
              value={
                detail.project
                  ? `${detail.project.code ?? ""} ${detail.project.name ?? ""}`.trim()
                  : null
              }
            />
            <InfoItem label="转换时间" value={formatDate(detail.convertedAt)} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
          </div>
        }
      >
        {detail.description ? (
          <section className="border-border rounded-md border p-4">
            <h2 className="text-ink-primary mb-2 text-sm font-semibold">描述</h2>
            <p className="text-sm whitespace-pre-wrap text-ink-secondary">{detail.description}</p>
          </section>
        ) : null}
        {detail.convertedBy ? (
          <section className="border-border rounded-md border p-4">
            <h2 className="text-ink-primary mb-2 text-sm font-semibold">转换信息</h2>
            <p className="text-sm text-ink-secondary">转换人：{detail.convertedBy}</p>
          </section>
        ) : null}
      </EntityDetailWorkspace>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("project-opportunity", "view")}>
      <OpportunityDetailPage />
    </PermissionGuard>
  );
}
