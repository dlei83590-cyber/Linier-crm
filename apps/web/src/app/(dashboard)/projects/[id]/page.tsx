"use client";

/**
 * Projects — 项目管理详情页（F2-4A CRM/Project Workspace，CTO #11974）
 *
 * 依据 Contract Card（projects.md）：backend CRUD FINAL + transition/close/acceptance。
 * F2-4A 基础版：EntityDetailWorkspace（Header Summary → Status → Sections）；
 * F2-4B 升级为 Workspace Tabs（Overview/Stakeholders/Milestones/Tasks/Risks/Visits/...）。
 * 不改 backend / 状态机 / action；transition/close/acceptance（Tier 3 factActions）保持 HOLD。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityDetailWorkspace, StatusBadge, ErrorPanel } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

interface ProjectDetail {
  id: string;
  code: string;
  name: string;
  stage: string;
  priority: string | null;
  progressPercent: string | null;
  paymentStatus: string;
  expectedContractAmount: string | null;
  expectedProfit: string | null;
  expectedGrossMarginRate: string | null;
  receivedAmount: string | null;
  receivableBalance: string | null;
  ownerId: string | null;
  description: string | null;
  createdAt: string;
  customer?: { id: string; code: string | null; name: string | null; type: string | null } | null;
  opportunity?: { id: string; code: string | null; name: string | null; stage: string | null } | null;
  closure?: { id: string; closedAt: string | null; reason: string | null } | null;
  milestones?: Array<{
    id: string;
    name: string;
    status: string;
    plannedDate: string | null;
    actualDate: string | null;
  }>;
  tasks?: Array<{
    id: string;
    name: string;
    status: string;
    priority: string | null;
    dueDate: string | null;
  }>;
  risks?: Array<{
    id: string;
    description: string;
    status: string;
    probability: string | null;
    impact: string | null;
  }>;
  visits?: Array<{
    id: string;
    visitedAt: string;
    contactName: string | null;
    summary: string | null;
  }>;
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

const PRIORITY_LABELS: Record<string, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};

const PAYMENT_LABELS: Record<string, string> = {
  UNPAID: "未回款",
  PARTIAL: "部分回款",
  PAID: "已回款",
  OVERDUE: "逾期",
};

const TASK_STATUS_LABELS: Record<string, string> = {
  TODO: "待办",
  IN_PROGRESS: "进行中",
  DONE: "已完成",
  CANCELLED: "已取消",
};

const RISK_STATUS_LABELS: Record<string, string> = {
  OPEN: "开启",
  MITIGATING: "应对中",
  CLOSED: "已关闭",
};

const MILESTONE_STATUS_LABELS: Record<string, string> = {
  PLANNED: "计划中",
  IN_PROGRESS: "进行中",
  COMPLETED: "已完成",
  DELAYED: "已延期",
};

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function ProjectDetailPage() {
  const { state } = useSession();
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("project", "edit"));
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<ProjectDetail>(`/api/projects/${id}`, { signal: controller.signal })
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
        <Link href="/projects" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          返回列表
        </Link>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <EntityDetailWorkspace
        title={`项目管理详情 — ${detail.code}`}
        backHref="/projects"
        status={detail.stage}
        statusLabel={STAGE_LABELS[detail.stage] ?? detail.stage}
        statusTone={STAGE_TONE_MAP[detail.stage] ?? "neutral"}
        actions={
          canEdit && !detail.closure ? (
            <Link
              href={`/projects/${id}/edit`}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              编辑
            </Link>
          ) : undefined
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="项目编号" value={detail.code} />
            <InfoItem label="项目名称" value={detail.name} />
            <InfoItem label="客户" value={detail.customer?.name} />
            <InfoItem
              label="来源机会"
              value={
                detail.opportunity
                  ? `${detail.opportunity.code ?? ""} ${detail.opportunity.name ?? ""}`.trim()
                  : null
              }
            />
            <InfoItem
              label="优先级"
              value={detail.priority ? PRIORITY_LABELS[detail.priority] ?? detail.priority : null}
            />
            <InfoItem
              label="进度"
              value={detail.progressPercent != null ? `${detail.progressPercent}%` : null}
            />
            <InfoItem
              label="回款状态"
              value={PAYMENT_LABELS[detail.paymentStatus] ?? detail.paymentStatus}
            />
            <InfoItem label="预计合同金额" value={detail.expectedContractAmount} />
            <InfoItem label="预计利润" value={detail.expectedProfit} />
            <InfoItem
              label="预计毛利率"
              value={detail.expectedGrossMarginRate != null ? `${detail.expectedGrossMarginRate}%` : null}
            />
            <InfoItem label="已回款金额" value={detail.receivedAmount} />
            <InfoItem label="应收余额" value={detail.receivableBalance} />
            <InfoItem label="负责人" value={detail.ownerId} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem
              label="结项"
              value={
                detail.closure
                  ? `${detail.closure.reason ?? "已结项"}（${formatDate(detail.closure.closedAt)}）`
                  : null
              }
            />
          </div>
        }
      >
        {detail.description ? (
          <section className="border-border rounded-md border p-4">
            <h2 className="text-ink-primary mb-2 text-sm font-semibold">描述</h2>
            <p className="text-sm whitespace-pre-wrap text-ink-secondary">{detail.description}</p>
          </section>
        ) : null}

        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            里程碑（{detail.milestones?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">名称</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">计划日期</th>
                  <th className="px-3 py-2 font-medium">实际日期</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {(detail.milestones ?? []).map((m) => (
                  <tr key={m.id}>
                    <td className="px-3 py-2 text-ink-primary">{m.name}</td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        status={m.status}
                        label={MILESTONE_STATUS_LABELS[m.status] ?? m.status}
                      />
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(m.plannedDate)}</td>
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(m.actualDate)}</td>
                  </tr>
                ))}
                {(detail.milestones ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-ink-muted">
                      暂无里程碑
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            任务（{detail.tasks?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">名称</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">优先级</th>
                  <th className="px-3 py-2 font-medium">截止日期</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {(detail.tasks ?? []).map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 py-2 text-ink-primary">{t.name}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={t.status} label={TASK_STATUS_LABELS[t.status] ?? t.status} />
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {t.priority ? PRIORITY_LABELS[t.priority] ?? t.priority : "—"}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(t.dueDate)}</td>
                  </tr>
                ))}
                {(detail.tasks ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-ink-muted">
                      暂无任务
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            风险（{detail.risks?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">描述</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">概率</th>
                  <th className="px-3 py-2 font-medium">影响</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {(detail.risks ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 text-ink-primary">{r.description}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} label={RISK_STATUS_LABELS[r.status] ?? r.status} />
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{r.probability ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{r.impact ?? "—"}</td>
                  </tr>
                ))}
                {(detail.risks ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-ink-muted">
                      暂无风险
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="border-border rounded-md border p-4">
          <h2 className="text-ink-primary mb-3 text-sm font-semibold">
            走访（{detail.visits?.length ?? 0}）
          </h2>
          <div className="overflow-x-auto">
            <table className="divide-border min-w-full divide-y text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">走访时间</th>
                  <th className="px-3 py-2 font-medium">客户联系人</th>
                  <th className="px-3 py-2 font-medium">沟通纪要</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {(detail.visits ?? []).map((v) => (
                  <tr key={v.id}>
                    <td className="px-3 py-2 text-ink-secondary">{formatDate(v.visitedAt)}</td>
                    <td className="px-3 py-2 text-ink-secondary">{v.contactName ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-secondary">{v.summary ?? "—"}</td>
                  </tr>
                ))}
                {(detail.visits ?? []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-sm text-ink-muted">
                      暂无走访记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </EntityDetailWorkspace>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.PROJECT_READ}>
      <ProjectDetailPage />
    </PermissionGuard>
  );
}
