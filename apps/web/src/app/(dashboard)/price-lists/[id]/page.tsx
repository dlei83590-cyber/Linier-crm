"use client";

/**
 * Price Lists — 价格表详情页（F2-2 Master Data Workspaces）
 *
 * 依据 Contract Card（price-lists.md）：backend detail FINAL → 实现 Detail。
 * 审计：GET /api/audit-logs?entityType=priceList&entityId={id}（已有 read contract）。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { hasPermission, PERMISSIONS, actionPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import {
  AppPage,
  EntityDetailWorkspace,
  ErrorPanel,
  AuditTimeline,
  type AuditEvent,
} from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

interface PriceListDetail {
  id: string;
  code: string;
  name: string;
  priceType?: string | null;
  status?: string | null;
  currency?: string | null;
  baseCurrency?: string | null;
  quoteCurrency?: string | null;
  priceSource?: string | null;
  freightIncluded?: boolean | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  policy?: { id: string; code: string | null; name: string | null; policyType: string | null } | null;
  versions?: Array<{ id: string; versionNo: number; effectiveFrom?: string | null; effectiveTo?: string | null }>;
  items?: Array<{
    id: string;
    unitPrice?: string | null;
    minOrderQty?: number | null;
    item?: { id: string; code: string | null; name: string | null; model: string | null } | null;
  }>;
}

interface AuditLogRow {
  id: string;
  action: string;
  result: string;
  createdAt: string;
  actor?: { id: string; email: string | null; name: string | null } | null;
}

const PRICE_TYPE_LABELS: Record<string, string> = {
  PURCHASE: "采购",
  SALES: "销售",
  VIP: "VIP",
  AGENT: "代理",
  ENGINEERING: "工程",
  STRATEGIC: "战略",
  REGIONAL: "区域",
  CUSTOMER: "客户",
  HISTORICAL: "历史",
};

const STATUS_TONE_MAP: Record<string, "neutral" | "success" | "danger"> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  ARCHIVED: "danger",
};

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</p>
    </div>
  );
}

function PriceListDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { state } = useSession();
  const canEdit =
    state.status === "authenticated" &&
    state.user !== null &&
    hasPermission(state.user.roles as RoleCode[], actionPermission("price-list", "edit"));

  const [detail, setDetail] = useState<PriceListDetail | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch<PriceListDetail>(`/api/price-lists/${id}`, { signal: controller.signal }),
      apiFetch<AuditLogRow[]>(`/api/audit-logs?entityType=priceList&entityId=${id}&pageSize=20`, {
        signal: controller.signal,
      }).catch(() => ({ data: [] as AuditLogRow[], success: true })),
    ])
      .then(([plBody, auditBody]) => {
        setDetail(plBody.data);
        setAudit(
          auditBody.data.map((a) => ({
            id: a.id,
            action: a.action,
            actor: a.actor?.name ?? a.actor?.email ?? null,
            at: a.createdAt,
            note: a.result,
          })),
        );
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  if (loading) {
    return (
      <AppPage>
        <div className="rounded-lg border border-border bg-surface p-6 text-sm text-ink-muted">
          加载中…
        </div>
      </AppPage>
    );
  }

  if (error || !detail) {
    return (
      <AppPage>
        <ErrorPanel error={error} />
        <Link href="/price-lists" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          返回列表
        </Link>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <EntityDetailWorkspace
        title={`价格表详情 — ${detail.name}`}
        description={`编码：${detail.code}`}
        backHref="/price-lists"
        status={detail.status ?? undefined}
        statusTone={detail.status ? STATUS_TONE_MAP[detail.status] : undefined}
        actions={
          canEdit ? (
            <Link
              href={`/price-lists/${id}/edit`}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              编辑
            </Link>
          ) : undefined
        }
        summary={
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem
              label="价格类型"
              value={detail.priceType ? PRICE_TYPE_LABELS[detail.priceType] ?? detail.priceType : null}
            />
            <InfoItem label="币种" value={detail.currency} />
            <InfoItem label="策略" value={detail.policy?.name ?? null} />
            <InfoItem label="含运费" value={detail.freightIncluded ? "是" : "否"} />
            <InfoItem label="生效" value={formatDate(detail.effectiveFrom)} />
            <InfoItem label="失效" value={formatDate(detail.effectiveTo)} />
            <InfoItem label="创建时间" value={formatDate(detail.createdAt)} />
            <InfoItem label="更新时间" value={formatDate(detail.updatedAt)} />
          </div>
        }
        audit={
          <div>
            <h2 className="mb-3 text-sm font-semibold text-ink-primary">审计记录</h2>
            <AuditTimeline events={audit} />
          </div>
        }
      >
        <div className="space-y-4">
          {detail.items && detail.items.length > 0 ? (
            <section className="rounded-md border border-border p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink-primary">
                价格条目（{detail.items.length}）
              </h2>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-medium text-ink-secondary">
                    <tr>
                      <th className="px-3 py-2 font-medium">物料编码</th>
                      <th className="px-3 py-2 font-medium">物料名称</th>
                      <th className="px-3 py-2 font-medium">型号</th>
                      <th className="px-3 py-2 font-medium">单价</th>
                      <th className="px-3 py-2 font-medium">最小起订量</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detail.items.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-2 text-ink-primary">{line.item?.code ?? "—"}</td>
                        <td className="px-3 py-2 text-ink-primary">{line.item?.name ?? "—"}</td>
                        <td className="px-3 py-2 text-ink-primary">{line.item?.model ?? "—"}</td>
                        <td className="px-3 py-2 text-ink-primary">{line.unitPrice ?? "—"}</td>
                        <td className="px-3 py-2 text-ink-primary">{line.minOrderQty ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {detail.versions && detail.versions.length > 0 ? (
            <section className="rounded-md border border-border p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink-primary">版本历史</h2>
              <ul className="space-y-2">
                {detail.versions.map((v) => (
                  <li key={v.id} className="flex items-baseline gap-3 text-sm">
                    <span className="font-medium text-ink-primary">v{v.versionNo}</span>
                    <span className="text-xs text-ink-muted">
                      {formatDate(v.effectiveFrom)} → {formatDate(v.effectiveTo)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </EntityDetailWorkspace>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.PRICE_LIST_READ}>
      <PriceListDetailPage />
    </PermissionGuard>
  );
}
