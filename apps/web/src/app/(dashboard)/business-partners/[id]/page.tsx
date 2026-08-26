"use client";

/**
 * BusinessPartner Customer 360 Workspace（FE 2.0 设计标杆）
 *
 * 结构：身份 Header（名称/编号/类型/审批状态/区域/负责人 + 按权限 Quick Actions）
 * → Summary KPI 条（联系人/商机/最近跟进/最近订单/累计销售/客户状态）
 * → 轻量 underline Tab（域 Accent + 150ms 内容入场，prefers-reduced-motion 直显）
 * → Tab 内容统一三态（PageLoading 骨架 / ErrorPanel+重试 / EmptyState）+ DataTable（sticky header
 *   / hover row / 金额右对齐 tabular-nums / 行操作省略号菜单 / 长文本 truncate+tooltip）。
 *
 * 数据全部来自既有权威 API（零 mock）：detail / pool-status(负责人) / 各列表 API（meta.total 计数）/
 * activities（最近跟进）。累计销售无 per-customer 服务端汇总 API → 以订单数（meta.total）诚实呈现，
 * 禁止客户端求和伪造权威累计额（PR body 声明）。
 *
 * 红线：不实现新领域能力；不复制业务字段；Sales/AR/Project 数据由各自 authoritative model 提供。
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, ErrorPanel, StatusBadge } from "@/components/workspace";
import { PageLoading } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useSession } from "@/lib/session-context";
import { formatDate, formatMoney, formatMoneyValue } from "@/lib/format";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { ContactWorkspace } from "./contact-workspace";
import { PoolStatusCard } from "./pool-status-card";
import { ActivityTimeline } from "./activity-timeline";
import { CustomerProducts } from "./customer-products";
import { CustomerSuppliers } from "./customer-suppliers";
import { CustomerDocuments } from "./customer-documents";
import { SupplierProfile } from "./supplier-profile";
import { DetailTabs, TabContent } from "./detail-tabs";
import { CustomerSummary, type CustomerSummaryData } from "./customer-summary";
import { DataTable, RowMenu, TruncateCell, type DataTableColumn } from "./data-table";

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
  channel?: string | null;
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
  isActive?: boolean;
  approvalStatus?: string;
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
  suppliers?: Array<{
    id: string;
    code: string;
    name: string;
    status: string;
    rating?: number | null;
    defaultLeadTime?: number | null;
    minOrderQty?: string | null;
    currency: string;
    isPreferred: boolean;
    settlements?: Array<{
      id: string;
      paymentTerms?: string | null;
      creditDays?: number | null;
      paymentMethod?: string | null;
      currency: string;
    }>;
    qualifications?: Array<{
      id: string;
      qualType: string;
      qualName: string;
      certNo?: string | null;
      issueDate?: string | null;
      expireDate?: string | null;
      status: string;
    }>;
  }>;
  supplierItems?: Array<{
    id: string;
    supplierCode?: string | null;
    moq?: string | null;
    leadTime?: number | null;
    currency: string;
    purchasePrice?: string | null;
    isPreferred: boolean;
    paymentTerm?: string | null;
    incoterm?: string | null;
    item?: { id: string; code: string; name: string; spec?: string | null; model?: string | null; brand?: string | null } | null;
  }>;
}

type TabKey =
  | "overview" | "business" | "invoice" | "contacts" | "addresses" | "credit" | "tags"
  | "opportunities" | "projects" | "quotations" | "orders" | "ar"
  | "activity" | "pool"
  | "supplierProfile" | "purchaseOrders" | "supplierItems"
  | "products" | "suppliers" | "documents";

type ActivityMode = "FOLLOW_UP" | "VISIT_PLAN" | "CHECK_IN";

interface OpportunityLite { id: string; code: string; name: string; stage: string; }
interface ProjectLite { id: string; code: string; name: string; stage: string; }
interface QuotationLite { id: string; code: string; totalAmount: string; currency: string; }
interface OrderLite { id: string; code: string; totalAmount: string; currency: string; status: string; createdAt: string; }
interface ArLite { id: string; totalAmount: string; balanceAmount: string; currency: string; }
interface PurchaseOrderLite { id: string; code: string; orderDate: string; totalAmount: string; currency: string; status: string; }
interface ActivityLite { id: string; activityType: string; occurredAt: string; }
interface PoolStatusLite {
  activeOwnership: { owner: { id: string; name: string | null; email: string | null } } | null;
}

const TYPE_LABELS: Record<string, string> = { CUSTOMER: "客户", SUPPLIER: "供应商", BOTH: "客户/供应商" };
const ADDRESS_TYPE_LABELS: Record<string, string> = { REGISTERED: "注册", DELIVERY: "收货", INVOICE: "开票", CONTACT: "联系" };
const CREDIT_RATING_LABELS: Record<string, string> = { A: "A", B: "B", C: "C", D: "D" };
const CREDIT_STATUS_LABELS: Record<string, string> = { NORMAL: "正常", WARNING: "预警", RESTRICTED: "受限" };
const APPROVAL_LABELS: Record<string, string> = { DRAFT: "草稿", SUBMITTED: "已提交", APPROVED: "已批准", REJECTED: "已拒绝" };
const APPROVAL_TONE_MAP: Record<string, "neutral" | "info" | "success" | "danger"> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "success",
  REJECTED: "danger",
};
const STAGE_LABELS: Record<string, string> = {
  LEAD: "线索", QUALIFIED: "准入", SOLUTION: "方案", QUOTATION: "报价",
  SAMPLING: "试样", TESTING: "测试", SMALL_BATCH: "小批量", MASS_SUPPLY: "批量供货",
  PAUSED: "暂停", FAILED: "失败", CLOSED: "结项",
};
const STAGE_TONE_MAP: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  LEAD: "neutral", QUALIFIED: "info", SOLUTION: "info", QUOTATION: "warning",
  SAMPLING: "neutral", TESTING: "warning", SMALL_BATCH: "warning", MASS_SUPPLY: "success",
  PAUSED: "warning", FAILED: "danger", CLOSED: "neutral",
};
const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿", CONFIRMED: "已确认", PARTIALLY_DELIVERED: "部分交付",
  DELIVERED: "已交付", COMPLETED: "已完成", CANCELLED: "已取消",
};
const ORDER_TONE_MAP: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral", CONFIRMED: "success", PARTIALLY_DELIVERED: "warning",
  DELIVERED: "success", COMPLETED: "success", CANCELLED: "danger",
};
const PO_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿", SUBMITTED: "已提交", APPROVED: "已批准", CONFIRMED: "已确认",
  PARTIALLY_RECEIVED: "部分收货", RECEIVED: "已收货", CANCELLED: "已取消",
};

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-secondary">{label}</dt>
      <dd className="mt-1 text-sm text-ink-primary">{value ?? "—"}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-elevation-sm">
      <h2 className="mb-4 text-sm font-semibold text-ink-primary">{title}</h2>
      {children}
    </section>
  );
}

function PartnerDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canEdit = hasPermission(roles, actionPermission("business-partner", "edit"));
  const canCreateActivity = hasPermission(roles, actionPermission("project-visit", "create"));
  const canCreateOpportunity = hasPermission(roles, actionPermission("project-opportunity", "create"));

  const [detail, setDetail] = useState<PartnerDetail | null>(null);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("overview");
  const [reloadKey, setReloadKey] = useState(0);
  const [owner, setOwner] = useState<string | null>(null);
  const [activityMode, setActivityMode] = useState<ActivityMode>("FOLLOW_UP");

  const [opportunities, setOpportunities] = useState<OpportunityLite[]>([]);
  const [opportunityTotal, setOpportunityTotal] = useState(0);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [quotations, setQuotations] = useState<QuotationLite[]>([]);
  const [orders, setOrders] = useState<OrderLite[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [ar, setAr] = useState<ArLite[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderLite[]>([]);
  const [supplierItems, setSupplierItems] = useState<PartnerDetail["supplierItems"]>([]);
  const [latestActivity, setLatestActivity] = useState<ActivityLite | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    apiFetch<PartnerDetail>("/api/business-partners/" + id, { signal: controller.signal })
      .then((body) => {
        setDetail(body.data);
        setSupplierItems(body.data.supplierItems ?? []);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载客户失败", "NETWORK_ERROR"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, reloadKey]);

  // 负责人（公海 Ownership SSOT 只读投影；无 customer-pool:view 权限 → 静默隐藏）
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    apiFetch<PoolStatusLite>("/api/business-partners/" + id + "/pool-status", { signal: controller.signal })
      .then((b) => {
        const o = b.data?.activeOwnership?.owner;
        setOwner(o ? o.name ?? o.email : null);
      })
      .catch(() => setOwner(null));
    return () => controller.abort();
  }, [id]);

  // 最近跟进（activities 最新一条，只读投影）
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    apiFetch<ActivityLite[]>("/api/business-partners/" + id + "/activities?page=1&pageSize=1", { signal: controller.signal })
      .then((b) => setLatestActivity(Array.isArray(b.data) && b.data.length > 0 ? b.data[0] : null))
      .catch(() => setLatestActivity(null));
    return () => controller.abort();
  }, [id]);

  // 供应商档案：采购订单（PurchaseOrder.supplierId → Supplier，只读聚合最近 5 条）
  const supplier = detail?.suppliers?.[0];
  useEffect(() => {
    if (!supplier?.id) {
      setPurchaseOrders([]);
      return;
    }
    const controller = new AbortController();
    apiFetch<PurchaseOrderLite[]>(
      "/api/purchase-orders?pageSize=5&supplierId=" + supplier.id,
      { signal: controller.signal },
    )
      .then((b) => setPurchaseOrders(Array.isArray(b.data) ? b.data : []))
      .catch(() => setPurchaseOrders([]));
    return () => controller.abort();
  }, [supplier?.id]);

  // 聚合各权威列表 API（customerId 过滤；最近 5 条只读展示 + meta.total 真实计数）
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const fetchList = async <T,>(url: string): Promise<{ items: T[]; total: number }> => {
      try {
        const b = await apiFetch<T[] | { items: T[]; total: number }>(url, { signal: controller.signal });
        if (Array.isArray(b.data)) {
          return { items: b.data, total: b.meta?.total ?? b.data.length };
        }
        return { items: b.data.items, total: b.data.total };
      } catch {
        return { items: [] as T[], total: 0 };
      }
    };
    Promise.all([
      fetchList<OpportunityLite>("/api/project-opportunities?pageSize=5&customerId=" + id),
      fetchList<ProjectLite>("/api/projects?pageSize=5&customerId=" + id),
      fetchList<QuotationLite>("/api/quotations?pageSize=5&customerId=" + id),
      fetchList<OrderLite>("/api/sales-orders?pageSize=5&customerId=" + id),
      fetchList<ArLite>("/api/accounts-receivables?pageSize=5&customerId=" + id),
    ])
      .then(([o, p, q, so, a]) => {
        setOpportunities(o.items);
        setOpportunityTotal(o.total);
        setProjects(p.items);
        setQuotations(q.items);
        setOrders(so.items);
        setOrderTotal(so.total);
        setAr(a.items);
      });
    return () => controller.abort();
  }, [id]);

  const retry = () => {
    setReloadKey((k) => k + 1);
    setLoadError(null);
  };

  if (loading) {
    return (
      <AppPage maxWidth="6xl">
        <PageLoading rows={6} />
      </AppPage>
    );
  }
  if (loadError || !detail) {
    return (
      <AppPage maxWidth="6xl">
        <ErrorPanel error={loadError ?? new ApiClientError(404, "往来单位不存在", "NOT_FOUND")} onRetry={retry} />
      </AppPage>
    );
  }

  const isSupplier = detail.type === "SUPPLIER" || detail.type === "BOTH";
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
    ...(isSupplier
      ? ([
          { key: "supplierProfile" as TabKey, label: "供应商档案" },
          { key: "purchaseOrders" as TabKey, label: "采购订单" },
          { key: "supplierItems" as TabKey, label: "供应物料" },
        ] as Array<{ key: TabKey; label: string }>)
      : []),
    { key: "activity", label: "活动/跟进" },
    { key: "pool", label: "公海" },
    { key: "products", label: "产品" },
    { key: "suppliers", label: "供应商" },
    { key: "documents", label: "文档" },
  ];

  const cr = detail.partnerCredit;

  const opportunityColumns: DataTableColumn<OpportunityLite>[] = [
    { key: "code", header: "编码", render: (r) => <Link href={"/project-opportunities/" + r.id} className="font-medium text-brand-600 hover:underline">{r.code}</Link> },
    { key: "name", header: "名称", render: (r) => <TruncateCell text={r.name} /> },
    { key: "stage", header: "阶段", render: (r) => <StatusBadge status={r.stage} label={STAGE_LABELS[r.stage] ?? r.stage} tone={STAGE_TONE_MAP[r.stage]} /> },
  ];
  const projectColumns: DataTableColumn<ProjectLite>[] = [
    { key: "code", header: "编码", render: (r) => <Link href={"/projects/" + r.id} className="font-medium text-brand-600 hover:underline">{r.code}</Link> },
    { key: "name", header: "名称", render: (r) => <TruncateCell text={r.name} /> },
    { key: "stage", header: "阶段", render: (r) => <StatusBadge status={r.stage} label={STAGE_LABELS[r.stage] ?? r.stage} tone={STAGE_TONE_MAP[r.stage]} /> },
  ];
  const quotationColumns: DataTableColumn<QuotationLite>[] = [
    { key: "code", header: "报价单号", render: (r) => <Link href={"/sales/quotations/" + r.id} className="font-medium text-brand-600 hover:underline">{r.code}</Link> },
    { key: "totalAmount", header: "含税金额", align: "right", render: (r) => formatMoney(r.totalAmount, r.currency) },
  ];
  const orderColumns: DataTableColumn<OrderLite>[] = [
    { key: "code", header: "订单号", render: (r) => <Link href={"/sales/orders/" + r.id} className="font-medium text-brand-600 hover:underline">{r.code}</Link> },
    { key: "createdAt", header: "下单时间", render: (r) => formatDate(r.createdAt) },
    { key: "totalAmount", header: "含税金额", align: "right", render: (r) => formatMoney(r.totalAmount, r.currency) },
    { key: "status", header: "状态", render: (r) => <StatusBadge status={r.status} label={ORDER_STATUS_LABELS[r.status] ?? r.status} tone={ORDER_TONE_MAP[r.status]} /> },
  ];
  const arColumns: DataTableColumn<ArLite>[] = [
    { key: "totalAmount", header: "应收金额", align: "right", render: (r) => formatMoney(r.totalAmount, r.currency) },
    { key: "balanceAmount", header: "余额", align: "right", render: (r) => formatMoney(r.balanceAmount, r.currency) },
    { key: "actions", header: "", render: (r) => (
      <RowMenu ariaLabel="应收行操作" items={[{ label: "查看详情", href: "/sales/accounts-receivable/" + r.id }]} />
    ) },
  ];
  const purchaseOrderColumns: DataTableColumn<PurchaseOrderLite>[] = [
    { key: "code", header: "采购订单号", render: (r) => <Link href={"/purchasing/orders/" + r.id} className="font-medium text-brand-600 hover:underline">{r.code}</Link> },
    { key: "orderDate", header: "下单日期", render: (r) => formatDate(r.orderDate) },
    { key: "totalAmount", header: "含税金额", align: "right", render: (r) => formatMoney(r.totalAmount, r.currency) },
    { key: "status", header: "状态", render: (r) => <StatusBadge status={r.status} label={PO_STATUS_LABELS[r.status] ?? r.status} /> },
  ];
  const supplierItemColumns: DataTableColumn<NonNullable<PartnerDetail["supplierItems"]>[number]>[] = [
    { key: "itemCode", header: "物料编码", render: (r) => r.item ? <Link href={"/items/" + r.item.id} className="font-medium text-brand-600 hover:underline">{r.item.code}</Link> : "—" },
    { key: "itemName", header: "物料名称", render: (r) => r.item ? <TruncateCell text={r.item.name + (r.item.spec ? "（" + r.item.spec + "）" : "")} /> : "—" },
    { key: "supplierCode", header: "供应商料号", render: (r) => r.supplierCode ?? "—" },
    { key: "purchasePrice", header: "采购参考价", align: "right", render: (r) => r.purchasePrice != null ? formatMoney(r.purchasePrice, r.currency) : "—" },
    { key: "moq", header: "MOQ", align: "right", render: (r) => r.moq != null ? formatMoneyValue(r.moq) : "—" },
    { key: "leadTime", header: "交期（天）", align: "right", render: (r) => r.leadTime ?? "—" },
    { key: "isPreferred", header: "优选", render: (r) => (r.isPreferred ? "是" : "—") },
  ];

  const summaryData: CustomerSummaryData = {
    contactCount: detail.partnerContacts?.length ?? 0,
    opportunityCount: opportunityTotal,
    latestActivity: latestActivity ? { type: latestActivity.activityType, occurredAt: latestActivity.occurredAt } : null,
    latestOrder: orders[0]
      ? { id: orders[0].id, code: orders[0].code, totalAmount: orders[0].totalAmount, currency: orders[0].currency }
      : null,
    orderCount: orderTotal,
    approvalStatus: detail.approvalStatus ?? null,
    isActive: detail.isActive ?? true,
  };

  return (
    <AppPage maxWidth="6xl">
      <div className="space-y-5">
        {/* 身份 Header + Quick Actions */}
        <div className="rounded-xl border border-border bg-surface p-5 shadow-elevation-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-semibold text-ink-primary">{detail.name}</h1>
                <span className="rounded-full bg-domain-customer-project-50 px-2.5 py-0.5 text-xs font-medium text-domain-customer-project-700">
                  {TYPE_LABELS[detail.type] ?? detail.type}
                </span>
                {detail.approvalStatus ? (
                  <StatusBadge
                    status={detail.approvalStatus}
                    label={APPROVAL_LABELS[detail.approvalStatus] ?? detail.approvalStatus}
                    toneMap={APPROVAL_TONE_MAP}
                  />
                ) : null}
                {detail.isActive === false && (
                  <StatusBadge status="INACTIVE" label="已停用" tone="danger" />
                )}
              </div>
              <p className="mt-1.5 text-sm text-ink-secondary">
                编码 {detail.code}
                {detail.shortName || detail.fullName ? " · " + (detail.shortName || detail.fullName) : ""}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-secondary">
                <span>区域 {detail.region ?? "—"}</span>
                <span>行业 {detail.industry ?? "—"}</span>
                <span>负责人 {owner ?? "—"}</span>
                <span>主联系人 {detail.contactPerson ?? "—"}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canCreateActivity && (
                <>
                  <button type="button" onClick={() => { setActivityMode("FOLLOW_UP"); setTab("activity"); }} className={BUTTON_SECONDARY_CLASS}>
                    新增跟进
                  </button>
                  <button type="button" onClick={() => { setActivityMode("VISIT_PLAN"); setTab("activity"); }} className={BUTTON_SECONDARY_CLASS}>
                    创建拜访
                  </button>
                  <button type="button" onClick={() => { setActivityMode("CHECK_IN"); setTab("activity"); }} className={BUTTON_SECONDARY_CLASS}>
                    签到
                  </button>
                </>
              )}
              {canCreateOpportunity && (
                <Link href="/project-opportunities/new" className={BUTTON_SECONDARY_CLASS}>
                  创建商机
                </Link>
              )}
              {canEdit && (
                <Link href={"/business-partners/" + id + "/edit"} className={BUTTON_PRIMARY_CLASS}>
                  编辑客户
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Summary KPI 条 */}
        <CustomerSummary data={summaryData} />

        {/* Tab 导航 */}
        <DetailTabs tabs={TABS} active={tab} onChange={(k) => setTab(k as TabKey)} />

        {/* Tab 内容（key 触发 150ms 入场；reduced-motion 直显） */}
        <TabContent key={tab} tab={tab}>
          {tab === "overview" && (
            <Section title="概览">
              <dl className="grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-3 xl:grid-cols-4">
                <InfoItem label="简称" value={detail.shortName} />
                <InfoItem label="集团" value={detail.groupName} />
                <InfoItem label="区域" value={detail.region} />
                <InfoItem label="行业" value={detail.industry} />
                <InfoItem label="销售渠道" value={detail.channel ?? "未设置"} />
                <InfoItem label="来源渠道" value={detail.sourceChannel} />
                <InfoItem label="信用等级" value={cr?.rating ? (CREDIT_RATING_LABELS[cr.rating] ?? cr.rating) : null} />
                <InfoItem label="结算条款" value={detail.settlementTerms} />
                <InfoItem label="主联系人" value={detail.contactPerson} />
                <InfoItem label="电话" value={detail.phone} />
                <InfoItem label="邮箱" value={detail.email} />
                <InfoItem label="地址" value={<TruncateCell text={detail.address ?? ""} />} />
                <InfoItem label="官网" value={<TruncateCell text={detail.website ?? ""} />} />
              </dl>
            </Section>
          )}

          {tab === "business" && (
            <Section title="工商资料">
              <dl className="grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-3 xl:grid-cols-4">
                <InfoItem label="统一社会信用代码" value={detail.uscc} />
                <InfoItem label="纳税人类型" value={detail.taxpayerType} />
                <InfoItem label="法定代表人" value={detail.legalRepresentative} />
                <InfoItem label="注册地址" value={<TruncateCell text={detail.registeredAddress ?? ""} />} />
                <InfoItem label="企业规模" value={detail.companySize} />
                <InfoItem label="成立日期" value={formatDate(detail.foundedDate)} />
                <InfoItem label="注册资本（万元）" value={detail.registeredCapital} />
                <InfoItem label="员工人数" value={detail.employeeCount != null ? String(detail.employeeCount) : null} />
                <InfoItem label="开户银行" value={detail.bankName} />
                <InfoItem label="银行账号" value={detail.bankAccount} />
                <InfoItem label="微信公众号" value={detail.wechatOfficialAccount} />
              </dl>
            </Section>
          )}

          {tab === "invoice" && (
            <Section title="开票资料">
              {detail.invoiceInfoRecord ? (
                <dl className="grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-3 xl:grid-cols-4">
                  <InfoItem label="开票抬头" value={detail.invoiceInfoRecord.title} />
                  <InfoItem label="税号" value={detail.invoiceInfoRecord.uscc} />
                  <InfoItem label="纳税人类型" value={detail.invoiceInfoRecord.taxpayerType} />
                  <InfoItem label="注册地址" value={<TruncateCell text={detail.invoiceInfoRecord.registeredAddress ?? ""} />} />
                  <InfoItem label="注册电话" value={detail.invoiceInfoRecord.registeredPhone} />
                  <InfoItem label="开户银行" value={detail.invoiceInfoRecord.bankName} />
                  <InfoItem label="银行账号" value={detail.invoiceInfoRecord.bankAccountNo} />
                </dl>
              ) : (
                <EmptyState
                  title="暂无开票资料"
                  description="开票资料在「编辑客户」中维护，维护后展示在这里。"
                />
              )}
            </Section>
          )}

          {tab === "contacts" && (
            <Section title="联系人">
              <ContactWorkspace partnerId={id} />
            </Section>
          )}

          {tab === "addresses" && (
            <Section title="地址">
              {(detail.partnerAddresses ?? []).length > 0 ? (
                <DataTable
                  columns={[
                    { key: "addressType", header: "类型", render: (r) => ADDRESS_TYPE_LABELS[r.addressType] ?? r.addressType },
                    { key: "recipient", header: "收件人", render: (r) => r.recipient ?? "—" },
                    { key: "phone", header: "电话", render: (r) => r.phone ?? "—" },
                    { key: "region", header: "省市区", render: (r) => [r.province, r.city, r.district].filter(Boolean).join(" ") || "—" },
                    { key: "detail", header: "详细地址", render: (r) => <TruncateCell text={r.detail ?? ""} /> },
                    { key: "isDefault", header: "默认", render: (r) => (r.isDefault ? "是" : "—") },
                  ]}
                  rows={detail.partnerAddresses ?? []}
                  rowKey={(r) => r.id}
                />
              ) : (
                <EmptyState title="暂无地址记录" description="在「编辑客户」中维护联系地址。" />
              )}
            </Section>
          )}

          {tab === "credit" && (
            <Section title="信用">
              {cr ? (
                <dl className="grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-3 xl:grid-cols-4">
                  <InfoItem label="信用额度" value={cr.creditLimit != null ? formatMoney(cr.creditLimit, "CNY") : null} />
                  <InfoItem label="已用额度" value={cr.usedCredit != null ? formatMoney(cr.usedCredit, "CNY") : null} />
                  <InfoItem label="信用等级" value={cr.rating ? (CREDIT_RATING_LABELS[cr.rating] ?? cr.rating) : null} />
                  <InfoItem label="信用状态" value={cr.status ? (CREDIT_STATUS_LABELS[cr.status] ?? cr.status) : null} />
                  <InfoItem label="复核日期" value={formatDate(cr.reviewDate)} />
                </dl>
              ) : (
                <EmptyState title="暂无信用记录" description="信用记录由信用管理流程维护。" />
              )}
            </Section>
          )}

          {tab === "tags" && (
            <Section title="标签">
              {(detail.partnerTags ?? []).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {(detail.partnerTags ?? []).map((t) => (
                    <span key={t.id} className="rounded-full bg-canvas px-2.5 py-1 text-xs text-ink-primary">
                      {t.tag?.name ?? t.tag?.code ?? "—"}
                    </span>
                  ))}
                </div>
              ) : (
                <EmptyState title="暂无标签" />
              )}
            </Section>
          )}

          {tab === "opportunities" && (
            <Section title="商机">
              <DataTable
                columns={opportunityColumns}
                rows={opportunities}
                rowKey={(r) => r.id}
                empty={{ title: "暂无商机", description: "可在客户详情头部「创建商机」发起新的项目机会。" }}
              />
            </Section>
          )}

          {tab === "projects" && (
            <Section title="项目">
              <DataTable
                columns={projectColumns}
                rows={projects}
                rowKey={(r) => r.id}
                empty={{ title: "暂无项目", description: "商机转为项目后展示在这里。" }}
              />
            </Section>
          )}

          {tab === "quotations" && (
            <Section title="报价">
              <DataTable
                columns={quotationColumns}
                rows={quotations}
                rowKey={(r) => r.id}
                empty={{ title: "暂无报价", description: "与客户相关的报价单会展示在这里。" }}
              />
            </Section>
          )}

          {tab === "orders" && (
            <Section title="销售订单">
              <DataTable
                columns={orderColumns}
                rows={orders}
                rowKey={(r) => r.id}
                empty={{ title: "暂无销售订单", description: "报价转订单后展示在这里。" }}
              />
            </Section>
          )}

          {tab === "ar" && (
            <Section title="应收/回款">
              <DataTable
                columns={arColumns}
                rows={ar}
                rowKey={(r) => r.id}
                empty={{ title: "暂无应收记录", description: "发票开具后生成应收余额。" }}
              />
            </Section>
          )}

          {tab === "supplierProfile" && (
            <Section title="供应商档案">
              {supplier ? (
                <SupplierProfile supplierId={supplier.id} onChanged={() => setReloadKey((k) => k + 1)} />
              ) : (
                <EmptyState
                  title="暂无供应商档案"
                  description="供应商建档由供应商主数据/采购流程负责；建档后本页可维护资质/账期/信用。"
                />
              )}
            </Section>
          )}

          {tab === "purchaseOrders" && (
            <Section title="采购订单">
              <DataTable
                columns={purchaseOrderColumns}
                rows={purchaseOrders}
                rowKey={(r) => r.id}
                empty={{ title: "暂无采购订单", description: "在采购工作台创建并关联本供应商后展示在这里。" }}
              />
            </Section>
          )}

          {tab === "supplierItems" && (
            <Section title="供应物料">
              <DataTable
                columns={supplierItemColumns}
                rows={supplierItems ?? []}
                rowKey={(r) => r.id}
                empty={{ title: "暂无供应物料关系", description: "在物料详情维护供应商-物料关系后展示在这里。" }}
              />
            </Section>
          )}

          {tab === "activity" && <ActivityTimeline partnerId={id} initialMode={activityMode} />}
          {tab === "pool" && <PoolStatusCard partnerId={id} />}
          {tab === "products" && <CustomerProducts partnerId={id} />}
          {tab === "suppliers" && <CustomerSuppliers partnerId={id} />}
          {tab === "documents" && <CustomerDocuments partnerId={id} />}
        </TabContent>

        <Link href="/business-partners" className="inline-block text-sm text-brand-600 hover:underline">
          ← 返回往来单位列表
        </Link>
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
