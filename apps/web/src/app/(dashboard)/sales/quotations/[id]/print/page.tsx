"use client";

/**
 * Quotation Print View — 报价单标准打印版（CC-05 报价固定个性化打印模板）
 *
 * 独立 Print View：复用既有 GET /api/quotations/:id 真实数据（无新 API；
 * 仅 CC-05 最小只读投影：客户联系/地址/销售负责人（customerOwnerships active owner）+ 行单位，已随详情 include 返回）。
 * 浏览器打印（window.print + A4 print CSS，不引入 PDF/Word 引擎、无模板拖拽器）。
 *
 * 布局：公司 Logo/名称 → 报价单号/日期/有效期 → 客户（名称/联系人/地址）→
 * 报价行（序号/产品编码/产品名称/规格/数量/单位/单价/金额）→ 汇总（小计/税额/总金额）→
 * 商务条款/备注 → 底部（销售负责人/客户确认/公司签章位置）。
 * 打印要求：A4、thead 跨页重复、金额右对齐、中文字体栈、隐藏系统导航
 * （globals.css @media print 已隐藏 header/aside/footer；本页工具栏 print 时隐藏，无按钮进入纸张内容）。
 * PermissionGuard 对齐 API requirePermission("quotation:view")。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { ErrorPanel } from "@/components/workspace";
import { PageLoading } from "@/components/ui/skeleton";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { formatDateOnly, formatMoneyValue } from "@/lib/format";
import { BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import "./print-view.css";

interface PrintOwner {
  id: string;
  name: string | null;
  email: string | null;
}

interface PrintCustomer {
  id: string;
  code: string | null;
  name: string | null;
  fullName?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  customerOwnerships?: { owner: PrintOwner | null }[] | null;
}

interface PrintLine {
  id: string;
  lineNo: number;
  description: string;
  quantity: string;
  unitPrice: string;
  lineAmount?: string;
  item?: { id: string; code: string | null; name: string | null; model?: string | null; spec?: string | null } | null;
  uom?: { id: string; code: string | null; name: string | null; symbol?: string | null } | null;
}

interface PrintQuotation {
  id: string;
  code: string;
  quoteDate: string;
  validFrom?: string | null;
  validUntil?: string | null;
  currency: string;
  subtotal?: string;
  taxAmount?: string;
  totalAmount: string;
  paymentTerm?: string | null;
  remark?: string | null;
  customer?: PrintCustomer | null;
  lines?: PrintLine[];
}

/** 数量展示：去除 Decimal 尾部零（100.0000 → 100；12.5000 → 12.5），保留最多 4 位小数 */
function formatQty(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const cleaned = value.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
  return cleaned === "" ? "—" : cleaned;
}

function QuotationPrintView() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<PrintQuotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiClientError | null>(null);

  const reload = () => {
    setLoading(true);
    setError(null);
    apiFetch<PrintQuotation>("/api/quotations/" + id)
      .then((body) => setDetail(body.data))
      .catch((err: unknown) => {
        setError(
          err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"),
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiFetch<PrintQuotation>("/api/quotations/" + id, { signal: controller.signal })
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
      <div className="qv-viewport">
        <div className="qv-screen-panel">
          <PageLoading rows={6} />
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="qv-viewport">
        <div className="qv-screen-panel">
          <ErrorPanel error={error} onRetry={reload} />
          <Link href="/sales/quotations" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
            返回报价列表
          </Link>
        </div>
      </div>
    );
  }

  const customer = detail.customer;
  const salesOwner = customer?.customerOwnerships?.[0]?.owner ?? null;
  const lines = detail.lines ?? [];
  const spec = (line: PrintLine) => {
    const itemSpec = [line.item?.model, line.item?.spec].filter(Boolean).join(" / ");
    return itemSpec || "—";
  };

  return (
    <div className="qv-viewport">
      {/* 屏幕工具栏：打印时隐藏，不进入纸张内容 */}
      <div className="qv-toolbar">
        <Link href={"/sales/quotations/" + id} className={BUTTON_SECONDARY_CLASS}>
          ← 返回报价详情
        </Link>
        <button type="button" onClick={() => window.print()} className={BUTTON_PRIMARY_CLASS}>
          打印报价单
        </button>
      </div>

      <article className="qv-sheet">
        {/* 公司 Logo/名称 + 单据标题 + 元信息 */}
        <header className="qv-no-break">
          <div className="qv-doc-header">
            <div className="qv-brand">
              <span className="qv-logo-mark" aria-hidden="true">
                L
              </span>
              <div>
                <div className="qv-brand-name">Linier CRM</div>
                <div className="qv-doc-title">报 价 单</div>
              </div>
            </div>
            <table className="qv-meta-table">
              <tbody>
                <tr>
                  <th>报价单号</th>
                  <td>{detail.code}</td>
                </tr>
                <tr>
                  <th>报价日期</th>
                  <td>{formatDateOnly(detail.quoteDate)}</td>
                </tr>
                <tr>
                  <th>有效期自</th>
                  <td>{formatDateOnly(detail.validFrom)}</td>
                </tr>
                <tr>
                  <th>有效期至</th>
                  <td>{formatDateOnly(detail.validUntil)}</td>
                </tr>
                <tr>
                  <th>币种</th>
                  <td>{detail.currency}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </header>

        {/* 客户（名称/联系人/地址） */}
        <section className="qv-block qv-no-break">
          <h3 className="qv-block-title">客户信息</h3>
          <div className="qv-customer-grid">
            <div>
              <span className="qv-label">客户名称</span>
              <span className="qv-value">{customer?.name ?? "—"}</span>
            </div>
            <div>
              <span className="qv-label">联系人</span>
              <span className="qv-value">{customer?.contactPerson ?? "—"}</span>
            </div>
            <div>
              <span className="qv-label">电话</span>
              <span className="qv-value">{customer?.phone ?? "—"}</span>
            </div>
            <div>
              <span className="qv-label">邮箱</span>
              <span className="qv-value">{customer?.email ?? "—"}</span>
            </div>
            <div className="qv-span-full">
              <span className="qv-label">地址</span>
              <span className="qv-value">{customer?.address ?? "—"}</span>
            </div>
          </div>
        </section>

        {/* 报价行 */}
        <section className="qv-block">
          <h3 className="qv-block-title">报价明细（{lines.length} 项）</h3>
          <table className="qv-lines-table">
            <thead>
              <tr>
                <th className="qv-col-no">序号</th>
                <th>产品编码</th>
                <th>产品名称</th>
                <th>规格</th>
                <th className="qv-col-amount">数量</th>
                <th className="qv-col-uom">单位</th>
                <th className="qv-col-amount">单价</th>
                <th className="qv-col-amount">金额</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="qv-col-no">{line.lineNo}</td>
                  <td>{line.item?.code ?? "—"}</td>
                  <td>{line.item?.name ?? "—"}</td>
                  <td>{spec(line)}</td>
                  <td className="qv-col-amount">{formatQty(line.quantity)}</td>
                  <td className="qv-col-uom">{line.uom?.symbol ?? line.uom?.name ?? "—"}</td>
                  <td className="qv-col-amount">{formatMoneyValue(line.unitPrice)}</td>
                  <td className="qv-col-amount">{formatMoneyValue(line.lineAmount ?? "0")}</td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={8} className="qv-empty-cell">
                    暂无明细行
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* 汇总（小计/税额/总金额） */}
        <section className="qv-summary qv-no-break">
          <div className="qv-summary-row">
            <span>小计（未税）</span>
            <span>{formatMoneyValue(detail.subtotal ?? "0")}</span>
          </div>
          <div className="qv-summary-row">
            <span>税额</span>
            <span>{formatMoneyValue(detail.taxAmount ?? "0")}</span>
          </div>
          <div className="qv-summary-total">
            <span>含税总金额（{detail.currency}）</span>
            <span>{formatMoneyValue(detail.totalAmount)}</span>
          </div>
        </section>

        {/* 商务条款 / 备注 */}
        <section className="qv-block">
          <h3 className="qv-block-title">商务条款</h3>
          <p className="qv-paragraph">{detail.paymentTerm || "—"}</p>
          <h3 className="qv-block-title">备注</h3>
          <p className="qv-paragraph">{detail.remark || "—"}</p>
        </section>

        {/* 底部：销售负责人 / 客户确认 / 公司签章位置 */}
        <footer className="qv-doc-footer qv-no-break">
          <div className="qv-footer-item">
            <div className="qv-footer-label">销售负责人</div>
            <div className="qv-footer-value">{salesOwner?.name ?? salesOwner?.email ?? "—"}</div>
          </div>
          <div className="qv-footer-item">
            <div className="qv-footer-label">客户确认（签字 / 日期）</div>
            <div className="qv-sign-line" aria-hidden="true" />
          </div>
          <div className="qv-footer-item">
            <div className="qv-footer-label">公司签章（盖章处）</div>
            <div className="qv-seal-box" aria-hidden="true" />
          </div>
        </footer>
      </article>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("quotation", "view")}>
      <QuotationPrintView />
    </PermissionGuard>
  );
}
