"use client";

/**
 * BusinessPartner Customer 360 Workspace（Phase 1A，CTO Directive Contract Alignment）
 *
 * 客户详情统一聚合（只读）——围绕 BusinessPartner.id 展开：
 * 基本资料 / 工商资料 / 开票资料 / 联系人 / 地址 / 信用 / 标签（来自 GET /api/business-partners/:id）
 * + 商机 / 项目 / 报价 / 销售订单 / 应收回款（聚合各 authoritative 列表 API 的 customerId 过滤）
 * + 活动入口 / 公海 / 查重（Phase 2/3 未授权 → Coming-by-contract 占位，禁止 mock）
 *
 * 红线：不实现 Phase 2/3 新领域能力；不复制业务字段；Sales/AR/Project 数据由各自 authoritative model 提供。
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, ErrorPanel } from "@/components/workspace";
import { ContactWorkspace } from "./contact-workspace";
import { PoolStatusCard } from "./pool-status-card";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDate, formatMoney } from "@/lib/format";

interface PartnerDetail {
  id: string;
  code: string;
  name: string;
  shortName?: string | null;
  fullName?: string | null;
  type: string;
  uscc?: string | null;
  taxpayerType?: string | null;
  legalRepresentative?: string | null;
  registeredAddress?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  settlementTerms?: string | null;
  groupName?: string | null;
  region?: string | null;
  industry?: string | null;
  companySize?: string | null;
  creditRating?: string | null;
  sourceChannel?: string | null;
  foundedDate?: string | null;
  registeredCapital?: string | null;
  employeeCount?: number | null;
  website?: string | null;
  wechatOfficialAccount?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  invoiceInfoRecord?: {
    title?: string | null;
    uscc?: string | null;
    taxpayerType?: string | null;
    registeredAddress?: string | null;
    registeredPhone?: string | null;
    bankName?: string | null;
    bankAccountNo?: string | null;
  } | null;
  partnerContacts?: Array<{ id: string; name: string; title?: string | null; department?: string | null; phone?: string | null; email?: string | null; wechat?: string | null; isPrimary: boolean }>;
  partnerAddresses?: Array<{ id: string; addressType: string; recipient?: string | null; phone?: string | null; province?: string | null; city?: string | null; district?: string | null; detail?: string | null; isDefault: boolean }>;
  partnerTags?: Array<{ id: string; tag?: { id: string; code: string | null; name: string | null; color: string | null } | null }>;
  partnerCredit?: {
    id: string;
    creditLimit?: string | null;
    usedCredit?: string | null;
    rating?: string | null;
    status?: string | null;
    reviewDate?: string | null;
  } | null;
}

type TabKey =
  | "overview" | "business" | "invoice" | "contacts" | "addresses" | "credit" | "tags"
  | "opportunities" | "projects" | "quotations" | "orders" | "ar"
  | "activity" | "pool";

const TYPE_LABELS: Record<string, string> = { CUSTOMER: "客户", SUPPLIER: "供应商", BOTH: "客户/供应商" };
const ADDRESS_TYPE_LABELS: Record<string, string> = { REGISTERED: "注册", DELIVERY: "收货", INVOICE: "开票", CONTACT: "联系" };
const CREDIT_RATING_LABELS: Record<string, string> = { A: "A", B: "B", C: "C", D: "D" };
const CREDIT_STATUS_LABELS: Record<string, string> = { NORMAL: "正常", WARNING: "预警", RESTRICTED: "受限" };

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-ink-secondary">{label}</div>
      <div className="mt-0.5 text-sm text-ink-primary">{value ?? "—"}</div>
    </div>
  );
}

function ComingByContract({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center rounded-md border border-dashed border-border bg-canvas p-6 text-center">
      <p className="text-sm font-medium text-ink-primary">{title}</p>
      <p className="mt-1 text-xs text-ink-muted">该能力由合同 Phase {phase} 授权落地，当前尚未实现（不展示 mock 数据）。</p>
    </div>
  );
}

function PartnerDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<PartnerDetail | null>(null);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");

  const [opportunities, setOpportunities] = useState<Array<{ id: string; code: string; name: string; stage: string }>>([]);
  const [projects, setProjects] = useState<Array<{ id: string; code: string; name: string; stage: string }>>([]);
  const [quotations, setQuotations] = useState<Array<{ id: string; code: string; totalAmount: string; currency: string }>>([]);
  const [orders, setOrders] = useState<Array<{ id: string; code: string; totalAmount: string; currency: string; status: string }>>([]);
  const [ar, setAr] = useState<Array<{ id: string; totalAmount: string; balanceAmount: string; currency: string }>>([]);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<PartnerDetail>(`/api/business-partners/${id}`, { signal: controller.signal })
      .then((body) => setDetail(body.data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载客户失败", "NETWORK_ERROR"));
      });
    return () => controller.abort();
  }, [id]);

  // 聚合各权威列表 API（customerId 过滤；最近 5 条只读展示）
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const fetchList = <T,>(url: string) =>
      apiFetch<T>(url, { signal: controller.signal }).then((b) => (Array.isArray(b.data) ? b.data : [] as unknown as T)).catch(() => [] as unknown as T);
    Promise.all([
      fetchList<Array<{ id: string; code: string; name: string; stage: string }>>(`/api/project-opportunities?pageSize=5&customerId=${id}`),
      fetchList<Array<{ id: string; code: string; name: string; stage: string }>>(`/api/projects?pageSize=5&customerId=${id}`),
      fetchList<Array<{ id: string; code: string; totalAmount: string; currency: string }>>(`/api/quotations?pageSize=5&customerId=${id}`),
      fetchList<Array<{ id: string; code: string; totalAmount: string; currency: string; status: string }>>(`/api/sales-orders?pageSize=5&customerId=${id}`),
      fetchList<Array<{ id: string; totalAmount: string; balanceAmount: string; currency: string }>>(`/api/accounts-receivables?pageSize=5&customerId=${id}`),
    ])
      .then(([o, p, q, so, a]) => {
        setOpportunities(o as Array<{ id: string; code: string; name: string; stage: string }>);
        setProjects(p as Array<{ id: string; code: string; name: string; stage: string }>);
        setQuotations(q as Array<{ id: string; code: string; totalAmount: string; currency: string }>);
        setOrders(so as Array<{ id: string; code: string; totalAmount: string; currency: string; status: string }>);
        setAr(a as Array<{ id: string; totalAmount: string; balanceAmount: string; currency: string }>);
      });
    return () => controller.abort();
  }, [id]);

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

  const TABS: Array<{ key: TabKey; label: string }> = [
    { key: "overview", label: "概览" },
    { key: "business", label: "工商资料" },
    { key: "invoice", label: "开票资料" },
    { key: "contacts", label: "联系人" },
    { key: "addresses", label: "地址" },
    { key: "credit", label: "信用" },
    { key: "tags", label: "标签" },
    { key: "opportunities", label: "商机" },
    { key: "projects", label: "项目" },
    { key: "quotations", label: "报价" },
    { key: "orders", label: "销售订单" },
    { key: "ar", label: "应收/回款" },
    { key: "activity", label: "活动/跟进" },
    { key: "pool", label: "公海" },
  ];

  const cr = detail.partnerCredit;

  return (
    <AppPage maxWidth="6xl">
      <div className="space-y-4">
        {/* 头部 */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-ink-primary">{detail.name}</h1>
              <span className="rounded bg-canvas px-2 py-0.5 text-xs text-ink-secondary">{TYPE_LABELS[detail.type] ?? detail.type}</span>
              {cr?.status ? <span className="rounded bg-brand-50 px-2 py-0.5 text-xs text-brand-700">{CREDIT_STATUS_LABELS[cr.status] ?? cr.status}</span> : null}
            </div>
            <p className="mt-1 text-sm text-ink-secondary">编码 {detail.code}（{detail.shortName || detail.fullName || "—"}）</p>
          </div>
          <Link href={`/business-partners/${id}/edit`} className="rounded-md border border-border px-4 py-2 text-sm text-ink-primary hover:bg-canvas">
            编辑
          </Link>
        </div>

        {/* Tab 导航 */}
        <div className="border-border flex flex-wrap gap-1 border-b pb-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === t.key ? "bg-brand-600 font-medium text-white" : "text-ink-secondary hover:bg-canvas"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab 内容 */}
        {tab === "overview" && (
          <section className="rounded-md border border-border p-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <InfoItem label="简称" value={detail.shortName} />
              <InfoItem label="集团" value={detail.groupName} />
              <InfoItem label="区域" value={detail.region} />
              <InfoItem label="行业" value={detail.industry} />
              <InfoItem label="来源渠道" value={detail.sourceChannel} />
              <InfoItem label="信用等级" value={cr?.rating ? (CREDIT_RATING_LABELS[cr.rating] ?? cr.rating) : null} />
              <InfoItem label="结算条款" value={detail.settlementTerms} />
              <InfoItem label="主联系人" value={detail.contactPerson} />
              <InfoItem label="电话" value={detail.phone} />
              <InfoItem label="邮箱" value={detail.email} />
              <InfoItem label="地址" value={detail.address} />
              <InfoItem label="官网" value={detail.website} />
            </div>
          </section>
        )}

        {tab === "business" && (
          <section className="rounded-md border border-border p-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <InfoItem label="统一社会信用代码" value={detail.uscc} />
              <InfoItem label="纳税人类型" value={detail.taxpayerType} />
              <InfoItem label="法定代表人" value={detail.legalRepresentative} />
              <InfoItem label="注册地址" value={detail.registeredAddress} />
              <InfoItem label="企业规模" value={detail.companySize} />
              <InfoItem label="成立日期" value={formatDate(detail.foundedDate)} />
              <InfoItem label="注册资本（万元）" value={detail.registeredCapital} />
              <InfoItem label="员工人数" value={detail.employeeCount != null ? String(detail.employeeCount) : null} />
              <InfoItem label="开户银行" value={detail.bankName} />
              <InfoItem label="银行账号" value={detail.bankAccount} />
              <InfoItem label="微信公众号" value={detail.wechatOfficialAccount} />
            </div>
          </section>
        )}

        {tab === "invoice" && (
          <section className="rounded-md border border-border p-4">
            {detail.invoiceInfoRecord ? (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <InfoItem label="开票抬头" value={detail.invoiceInfoRecord.title} />
                <InfoItem label="税号" value={detail.invoiceInfoRecord.uscc} />
                <InfoItem label="纳税人类型" value={detail.invoiceInfoRecord.taxpayerType} />
                <InfoItem label="注册地址" value={detail.invoiceInfoRecord.registeredAddress} />
                <InfoItem label="注册电话" value={detail.invoiceInfoRecord.registeredPhone} />
                <InfoItem label="开户银行" value={detail.invoiceInfoRecord.bankName} />
                <InfoItem label="银行账号" value={detail.invoiceInfoRecord.bankAccountNo} />
              </div>
            ) : (
              <p className="text-sm text-ink-muted">暂无开票资料（编辑页维护）。</p>
            )}
          </section>
        )}

        {tab === "contacts" && (
          <section className="rounded-md border border-border p-4">
            <ContactWorkspace partnerId={id} />
          </section>
        )}

        {tab === "addresses" && (
          <section className="rounded-md border border-border p-4">
            {(detail.partnerAddresses ?? []).length > 0 ? (
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="text-ink-secondary bg-canvas text-left text-xs font-medium">
                  <tr>
                    <th className="px-4 py-2 font-semibold">类型</th>
                    <th className="px-4 py-2 font-semibold">收件人</th>
                    <th className="px-4 py-2 font-semibold">电话</th>
                    <th className="px-4 py-2 font-semibold">省市区</th>
                    <th className="px-4 py-2 font-semibold">详细地址</th>
                    <th className="px-4 py-2 font-semibold">默认</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(detail.partnerAddresses ?? []).map((a) => (
                    <tr key={a.id}>
                      <td className="px-4 py-2">{ADDRESS_TYPE_LABELS[a.addressType] ?? a.addressType}</td>
                      <td className="px-4 py-2">{a.recipient ?? "—"}</td>
                      <td className="px-4 py-2">{a.phone ?? "—"}</td>
                      <td className="px-4 py-2">{[a.province, a.city, a.district].filter(Boolean).join(" ") || "—"}</td>
                      <td className="px-4 py-2">{a.detail ?? "—"}</td>
                      <td className="px-4 py-2">{a.isDefault ? "是" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-ink-muted">暂无地址记录。</p>
            )}
          </section>
        )}

        {tab === "credit" && (
          <section className="rounded-md border border-border p-4">
            {cr ? (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <InfoItem label="信用额度" value={cr.creditLimit != null ? formatMoney(cr.creditLimit, "CNY") : null} />
                <InfoItem label="已用额度" value={cr.usedCredit != null ? formatMoney(cr.usedCredit, "CNY") : null} />
                <InfoItem label="信用等级" value={cr.rating ? (CREDIT_RATING_LABELS[cr.rating] ?? cr.rating) : null} />
                <InfoItem label="信用状态" value={cr.status ? (CREDIT_STATUS_LABELS[cr.status] ?? cr.status) : null} />
                <InfoItem label="复核日期" value={formatDate(cr.reviewDate)} />
              </div>
            ) : (
              <p className="text-sm text-ink-muted">暂无信用记录。</p>
            )}
          </section>
        )}

        {tab === "tags" && (
          <section className="rounded-md border border-border p-4">
            {(detail.partnerTags ?? []).length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {(detail.partnerTags ?? []).map((t) => (
                  <span key={t.id} className="rounded-md bg-canvas px-2 py-1 text-xs text-ink-primary">
                    {t.tag?.name ?? t.tag?.code ?? "—"}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-muted">暂无标签。</p>
            )}
          </section>
        )}

        {tab === "opportunities" && (
          <section className="rounded-md border border-border p-4">
            {opportunities.length > 0 ? (
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="text-ink-secondary bg-canvas text-left text-xs font-medium">
                  <tr><th className="px-4 py-2 font-semibold">编码</th><th className="px-4 py-2 font-semibold">名称</th><th className="px-4 py-2 font-semibold">阶段</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {opportunities.map((o) => (
                    <tr key={o.id}>
                      <td className="px-4 py-2"><Link href={`/project-opportunities/${o.id}`} className="font-medium text-brand-600 hover:underline">{o.code}</Link></td>
                      <td className="px-4 py-2">{o.name}</td>
                      <td className="px-4 py-2">{o.stage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-ink-muted">暂无商机。</p>
            )}
          </section>
        )}

        {tab === "projects" && (
          <section className="rounded-md border border-border p-4">
            {projects.length > 0 ? (
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="text-ink-secondary bg-canvas text-left text-xs font-medium">
                  <tr><th className="px-4 py-2 font-semibold">编码</th><th className="px-4 py-2 font-semibold">名称</th><th className="px-4 py-2 font-semibold">阶段</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {projects.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2"><Link href={`/projects/${p.id}`} className="font-medium text-brand-600 hover:underline">{p.code}</Link></td>
                      <td className="px-4 py-2">{p.name}</td>
                      <td className="px-4 py-2">{p.stage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-ink-muted">暂无项目。</p>
            )}
          </section>
        )}

        {tab === "quotations" && (
          <section className="rounded-md border border-border p-4">
            {quotations.length > 0 ? (
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="text-ink-secondary bg-canvas text-left text-xs font-medium">
                  <tr><th className="px-4 py-2 font-semibold">报价单号</th><th className="px-4 py-2 font-semibold">含税金额</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {quotations.map((q) => (
                    <tr key={q.id}>
                      <td className="px-4 py-2"><Link href={`/sales/quotations/${q.id}`} className="font-medium text-brand-600 hover:underline">{q.code}</Link></td>
                      <td className="px-4 py-2 tabular-nums">{formatMoney(q.totalAmount, q.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-ink-muted">暂无报价。</p>
            )}
          </section>
        )}

        {tab === "orders" && (
          <section className="rounded-md border border-border p-4">
            {orders.length > 0 ? (
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="text-ink-secondary bg-canvas text-left text-xs font-medium">
                  <tr><th className="px-4 py-2 font-semibold">订单号</th><th className="px-4 py-2 font-semibold">含税金额</th><th className="px-4 py-2 font-semibold">状态</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td className="px-4 py-2"><Link href={`/sales/orders/${o.id}`} className="font-medium text-brand-600 hover:underline">{o.code}</Link></td>
                      <td className="px-4 py-2 tabular-nums">{formatMoney(o.totalAmount, o.currency)}</td>
                      <td className="px-4 py-2">{o.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-ink-muted">暂无销售订单。</p>
            )}
          </section>
        )}

        {tab === "ar" && (
          <section className="rounded-md border border-border p-4">
            {ar.length > 0 ? (
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="text-ink-secondary bg-canvas text-left text-xs font-medium">
                  <tr><th className="px-4 py-2 font-semibold">应收金额</th><th className="px-4 py-2 font-semibold">余额</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ar.map((a) => (
                    <tr key={a.id}>
                      <td className="px-4 py-2 tabular-nums">{formatMoney(a.totalAmount, a.currency)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatMoney(a.balanceAmount, a.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-ink-muted">暂无应收记录。</p>
            )}
          </section>
        )}

        {tab === "activity" && <ComingByContract title="活动 / 跟进 / 拜访 / 签到" phase="3" />}
        {tab === "pool" && <PoolStatusCard partnerId={id} />}

        <Link href="/business-partners" className="text-sm text-brand-600 hover:underline">← 返回往来单位列表</Link>
      </div>
    </AppPage>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("business-partner", "view")}>
      <PartnerDetailPage />
    </PermissionGuard>
  );
}
