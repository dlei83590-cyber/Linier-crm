"use client";

/**
 * Project Opportunities — 项目机会详情页（UI-06 Opportunity + Project 现代重构）
 *
 * 依据 Contract Card（project-opportunities.md）：backend CRUD FINAL + convert。
 * 结构：AppPage + EntityDetailWorkspace（Header Summary → Status → Actions → Sections）。
 * 不改 backend / 状态机 / action。
 * FRT-05：convert 由 Tier 3 HOLD 开放 —— POST /api/project-opportunities/:id/convert（唯一入口，
 * 权限 = project-opportunity:create 或 project:create，前端镜像同权限）：
 *  - 未转换（convertedAt 为空且无 project）→「转为项目」按钮；成功后 router 跳转真实 /projects/{project.id}
 *  - 已转换 → 隐藏转换按钮，提供「查看项目」链接（/projects/{project.id}）
 *  - 409 ALREADY_CONVERTED（并发/重复点击）→ 展示真实错误并允许重试
 * 商机→报价→订单 MVP：新增「创建报价」入口（→ /sales/quotations/new?opportunityId=…）与
 * 关联报价只读区块（GET 详情 include quotations 投影，数据真实、零 mock）。
 * UI-06：Skeleton 加载态；金额 formatMoneyValue；转换成功 Toast；不展示 raw ownerId（红线：raw DB ID 不显示）。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { hasPermission, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { AppPage, EntityDetailWorkspace, ErrorPanel } from "@/components/workspace";
import { StatusBadge } from "@/components/workspace/status-badge";
import { PageLoading } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { formatDate, formatMoney, formatMoneyValue } from "@/lib/format";
import { PROJECT_STAGE_LABELS, PROJECT_STAGE_TONES } from "@/lib/project-stage";

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
  /** 商机跟进 MVP：该商机关联客户最近一次 FOLLOW_UP（服务端计算） */
  lastFollowUpAt: string | null;
  daysSinceFollowUp: number | null;
  needsFollowUp: boolean;
  followUpThresholdDays: number;
  customer?: { id: string; code: string | null; name: string | null; type: string | null } | null;
  project?: { id: string; code: string | null; name: string | null; stage: string | null } | null;
  /** 关联报价（商机→报价→订单 MVP：详情只读投影，GET API 已 include） */
  quotations?: Array<{
    id: string;
    code: string;
    status: string;
    quoteDate: string;
    currency: string;
    totalAmount: string;
    convertedAt: string | null;
    salesOrderId: string | null;
  }>;
}

const PAYMENT_LABELS: Record<string, string> = {
  UNPAID: "未回款",
  PARTIAL: "部分回款",
  PAID: "已回款",
  OVERDUE: "逾期",
};

const QUOTATION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  APPROVED: "已批准",
  SENT: "已发送",
  ACCEPTED: "客户已接受",
  REJECTED: "已拒绝",
  CANCELLED: "已取消",
  CONVERTED: "已转订单",
  EXPIRED: "已过期",
};

const QUOTATION_TONE_MAP: Record<string, "neutral" | "info" | "success" | "danger" | "warning"> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "success",
  SENT: "info",
  ACCEPTED: "success",
  REJECTED: "danger",
  CANCELLED: "danger",
  CONVERTED: "info",
  EXPIRED: "warning",
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
  const toast = useToast();
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("project-opportunity", "edit"));
  // 商机→报价 MVP：创建报价入口（quotation:create，与 POST /api/quotations 对齐；无权限不渲染）
  const canCreateQuotation =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("quotation", "create"));
  // FRT-05 convert 权限：与 backend requirePermission("project-opportunity:create") ?? requirePermission("project:create") 镜像
  const canConvert =
    state.status === "authenticated" &&
    state.user !== null &&
    (hasPermission(state.user.roles as RoleCode[], actionPermission("project-opportunity", "create")) ||
      hasPermission(state.user.roles as RoleCode[], actionPermission("project", "create")));
  const router = useRouter();
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<ApiClientError | null>(null);

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

  // FRT-05：转为项目（唯一入口 POST /api/project-opportunities/:id/convert）
  // 成功后跳转真实 Project（/projects/{project.id}）；409 ALREADY_CONVERTED 展示真实错误允许重试
  const runConvert = async () => {
    if (!detail || converting) return;
    setConverting(true);
    setConvertError(null);
    try {
      const body = await apiFetch<{ project: { id: string }; opportunityId: string; converted: boolean }>(
        `/api/project-opportunities/${id}/convert`,
        { method: "POST" },
      );
      const projectId = body.data?.project?.id;
      if (!projectId) {
        setConvertError(new ApiClientError(500, "转换成功但未返回项目信息", "INVALID_RESPONSE"));
        return;
      }
      toast.success("商机已转为项目");
      router.push(`/projects/${projectId}`);
    } catch (err) {
      setConvertError(
        err instanceof ApiClientError ? err : new ApiClientError(0, "转换失败", "NETWORK_ERROR"),
      );
    } finally {
      setConverting(false);
    }
  };

  if (loading) {
    return (
      <AppPage>
        <div className="border-border bg-surface shadow-elevation-sm overflow-hidden rounded-lg border">
          <PageLoading rows={4} />
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
        statusLabel={PROJECT_STAGE_LABELS[detail.stage] ?? detail.stage}
        statusTone={PROJECT_STAGE_TONES[detail.stage] ?? "neutral"}
        actions={
          canEdit || canCreateQuotation || canConvert || detail.project ? (
            <>
              {detail.project ? (
                <Link
                  href={"/projects/" + detail.project.id}
                  className={BUTTON_PRIMARY_CLASS}
                >
                  查看项目
                </Link>
              ) : null}
              {canConvert && !detail.project && (
                <button
                  type="button"
                  onClick={runConvert}
                  disabled={converting}
                  className={BUTTON_PRIMARY_CLASS + " disabled:cursor-not-allowed disabled:opacity-50"}
                >
                  {converting ? "转换中…" : "转为项目"}
                </button>
              )}
              {canCreateQuotation && (
                <Link
                  href={"/sales/quotations/new?opportunityId=" + encodeURIComponent(id)}
                  className={BUTTON_PRIMARY_CLASS}
                >
                  创建报价
                </Link>
              )}
              {canEdit && (
                <Link
                  href={"/project-opportunities/" + id + "/edit"}
                  className={BUTTON_SECONDARY_CLASS}
                >
                  编辑
                </Link>
              )}
            </>
          ) : undefined
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="机会编号" value={detail.code} />
            <InfoItem label="机会名称" value={detail.name} />
            <InfoItem label="客户" value={detail.customer?.name} />
            <InfoItem label="客户类型" value={detail.customer?.type} />
            <InfoItem label="预计营收" value={formatMoneyValue(detail.expectedRevenue)} />
            <InfoItem label="预计成本" value={formatMoneyValue(detail.expectedCost)} />
            <InfoItem label="毛利" value={formatMoneyValue(detail.grossProfit)} />
            <InfoItem
              label="成功率"
              value={detail.successProbability != null ? `${detail.successProbability}%` : null}
            />
            <InfoItem label="回款状态" value={PAYMENT_LABELS[detail.paymentStatus] ?? detail.paymentStatus} />
            <InfoItem label="费用预算" value={formatMoneyValue(detail.expenseBudget)} />
            <InfoItem label="销售目标" value={formatMoneyValue(detail.salesTarget)} />
            <InfoItem label="客户投入" value={formatMoneyValue(detail.customerInvestment)} />
            <InfoItem
              label="已转项目"
              value={
                detail.project ? (
                  <Link
                    href={"/projects/" + detail.project.id}
                    className="text-brand-600 hover:underline"
                  >
                    {`${detail.project.code ?? ""} ${detail.project.name ?? ""}`.trim()}
                  </Link>
                ) : null
              }
            />
            <InfoItem label="转换时间" value={formatDate(detail.convertedAt)} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem
              label="最近跟进时间"
              value={detail.lastFollowUpAt ? formatDate(detail.lastFollowUpAt) : "从未跟进"}
            />
            <InfoItem
              label="距今"
              value={detail.daysSinceFollowUp != null ? detail.daysSinceFollowUp + " 天" : "—"}
            />
            <InfoItem
              label="跟进状态"
              value={
                detail.needsFollowUp ? (
                  <StatusBadge
                    status="FOLLOWUP_DUE"
                    label={"待跟进（超 " + detail.followUpThresholdDays + " 天）"}
                    tone="warning"
                  />
                ) : (
                  "正常"
                )
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
        {convertError && (
          <section className="border-status-danger-border rounded-md border bg-status-danger-bg p-4">
            <h2 className="mb-2 text-sm font-semibold text-status-danger-text">转换失败</h2>
            <p className="text-sm text-status-danger-text">
              {convertError.message}
              {convertError.code ? "（" + convertError.code + "）" : ""}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={runConvert}
                disabled={converting}
                className={BUTTON_PRIMARY_CLASS + " disabled:cursor-not-allowed disabled:opacity-50"}
              >
                {converting ? "转换中…" : "重试"}
              </button>
              <button
                type="button"
                onClick={() => setConvertError(null)}
                className={BUTTON_SECONDARY_CLASS}
              >
                关闭
              </button>
            </div>
          </section>
        )}
        {detail.convertedBy ? (
          <section className="border-border rounded-md border p-4">
            <h2 className="text-ink-primary mb-2 text-sm font-semibold">转换信息</h2>
            <p className="text-sm text-ink-secondary">转换人：{detail.convertedBy}</p>
          </section>
        ) : null}
        {detail.quotations && detail.quotations.length > 0 ? (
          <section className="border-border rounded-md border p-4">
            <h2 className="text-ink-primary mb-3 text-sm font-semibold">
              相关报价（{detail.quotations.length}）
            </h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-canvas text-left text-xs font-medium text-ink-secondary">
                  <tr>
                    <th className="px-3 py-2 font-semibold">报价单号</th>
                    <th className="px-3 py-2 font-semibold">状态</th>
                    <th className="px-3 py-2 font-semibold">报价日期</th>
                    <th className="px-3 py-2 text-right font-semibold">含税合计</th>
                    <th className="px-3 py-2 font-semibold">销售订单</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {detail.quotations.map((q) => (
                    <tr key={q.id} className="transition-colors hover:bg-brand-50/40">
                      <td className="px-3 py-2">
                        <Link href={"/sales/quotations/" + q.id} className="text-brand-600 hover:underline">
                          {q.code}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge
                          status={q.status}
                          label={QUOTATION_STATUS_LABELS[q.status] ?? q.status}
                          tone={QUOTATION_TONE_MAP[q.status] ?? "neutral"}
                        />
                      </td>
                      <td className="px-3 py-2 text-ink-secondary">{formatDate(q.quoteDate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-primary">
                        {formatMoney(q.totalAmount, q.currency)}
                      </td>
                      <td className="px-3 py-2 text-ink-secondary">
                        {q.salesOrderId ? (
                          <Link href={"/sales/orders/" + q.salesOrderId} className="text-brand-600 hover:underline">
                            查看订单
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
