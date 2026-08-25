"use client";

/**
 * Expenses — 报销申请编辑/改稿页（FRT-09 报销闭环）
 *
 * DRAFT / REJECTED 状态可直接编辑（改稿），复用既有 PATCH /api/projects/:id/expenses/:eid
 * （ProjectExpense 乐观锁 version；服务端门禁：仅 DRAFT/REJECTED 可编辑，PENDING/APPROVED 冻结）。
 * - 归属（客户 → 项目）为承诺事实锁定：报销挂在项目下，编辑不允许改挂项目（需删除重建）
 * - GET /api/expenses/:id 为权威 version；PATCH 携带 version，409 VERSION_CONFLICT 走
 *   EntityFormWorkspace onReload（重新 GET → 更新 version → 重置 dirty），禁止 silent retry
 * - 保存成功后返回详情页刷新（服务端 version CAS 保证动作后数据正确）
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage, EntityFormWorkspace, ErrorPanel } from "@/components/workspace";
import { PageLoading } from "@/components/ui/skeleton";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS } from "@/lib/ui-classes";
import { useToast } from "@/components/ui/toast";

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
  project?: {
    id: string;
    code: string | null;
    name: string | null;
    stage: string | null;
    customer?: { id: string; code: string | null; name: string | null; type: string | null } | null;
  } | null;
}

// 常见费用科目（复用 ProjectExpense.category 字符串字段，不新建枚举；与新建页一致）
const CATEGORY_SUGGESTIONS = [
  "差旅费",
  "交通费",
  "餐饮费",
  "住宿费",
  "办公费",
  "通讯费",
  "业务招待费",
  "培训费",
  "快递费",
  "其他",
];

// 费用类型（高层分类，与科目区分；复用 ProjectExpense.expenseType 字符串字段）
const EXPENSE_TYPE_SUGGESTIONS = ["差旅", "业务招待", "办公", "通讯", "交通", "培训", "其他"];

// 费用归属（谁承担；复用 ProjectExpense.expenseAttribution 字符串字段）
const EXPENSE_ATTRIBUTION_OPTIONS = ["公司承担", "客户承担", "项目承担", "其他"];

const inputClass = INPUT_CLASS;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-primary">{title}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

function ExpenseEditForm() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const toast = useToast();

  const [detail, setDetail] = useState<ExpenseDetail | null>(null);
  const [notEditable, setNotEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);

  const [category, setCategory] = useState("");
  const [expenseType, setExpenseType] = useState("");
  const [expenseAttribution, setExpenseAttribution] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [incurredAt, setIncurredAt] = useState("");
  const [note, setNote] = useState("");
  const [version, setVersion] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const loadDetail = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    apiFetch<ExpenseDetail>("/api/expenses/" + id, { signal: controller.signal })
      .then((body) => {
        const d = body.data;
        setDetail(d);
        // 服务端门禁同源：仅 DRAFT / REJECTED 可编辑（PENDING/APPROVED 冻结）
        if (d.approvalStatus !== "DRAFT" && d.approvalStatus !== "REJECTED") {
          setNotEditable(true);
          setLoading(false);
          return;
        }
        setNotEditable(false);
        setVersion(d.version);
        setCategory(d.category ?? "");
        setExpenseType(d.expenseType ?? "");
        setExpenseAttribution(d.expenseAttribution ?? "");
        setAmount(d.amount ?? "");
        setCurrency(d.currency ?? "");
        // type=date 需要 YYYY-MM-DD（API 返回 ISO datetime）
        setIncurredAt(d.incurredAt ? d.incurredAt.slice(0, 10) : "");
        setNote(d.note ?? "");
        // 重新加载最新数据后重置 dirty（reload 成功才清）
        setDirty(false);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载失败", "NETWORK_ERROR"));
        setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  useEffect(() => loadDetail(), [loadDetail]);

  // F2-2 UX Hardening：409 VERSION_CONFLICT 后重新加载最新数据（保持 dirty=true 直到 GET 成功）
  const handleReload = () => {
    setError(null);
    setReloadKey((k) => k + 1);
  };

  useEffect(() => {
    if (reloadKey === 0) return;
    return loadDetail();
  }, [reloadKey, loadDetail]);

  const handleSave = () => {
    if (submitting || !detail) return;
    const amountNum = Number(amount);
    if (!category.trim()) {
      setError(new ApiClientError(400, "费用科目为必填项", "VALIDATION"));
      return;
    }
    if (!amount || !Number.isFinite(amountNum) || amountNum < 0) {
      setError(new ApiClientError(400, "请输入有效的非负金额", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    // 复用既有 ProjectExpense PATCH（乐观锁 version；服务端校验 DRAFT/REJECTED 门禁）
    apiFetch<{ id: string }>("/api/projects/" + detail.projectId + "/expenses/" + id, {
      method: "PATCH",
      body: JSON.stringify({
        version,
        category: category.trim(),
        expenseType: expenseType.trim() || null,
        expenseAttribution: expenseAttribution.trim() || null,
        amount: amountNum,
        currency: currency.trim() || "CNY",
        incurredAt: incurredAt ? new Date(incurredAt + "T00:00:00.000Z").toISOString() : null,
        note: note.trim() || null,
      }),
    })
      .then(() => {
        toast.success(detail.approvalStatus === "REJECTED" ? "改稿已保存，可重新提交审批" : "报销申请已保存");
        router.push("/expenses/" + id);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  if (loading) {
    return (
      <AppPage>
        <div className="border-border bg-surface overflow-hidden rounded-lg border">
          <PageLoading rows={5} />
        </div>
      </AppPage>
    );
  }

  if (loadError) {
    return (
      <AppPage>
        <ErrorPanel error={loadError} />
      </AppPage>
    );
  }

  if (notEditable || !detail) {
    return (
      <AppPage>
        <div className="border-border bg-surface rounded-lg border p-6">
          <p className="text-sm font-medium text-ink-primary">当前状态不可编辑</p>
          <p className="mt-1 text-sm text-ink-secondary">
            仅草稿或已驳回状态可编辑（当前状态：{detail?.approvalStatus ?? "—"}）
          </p>
          <button
            type="button"
            onClick={() => router.push("/expenses/" + id)}
            className="bg-brand-600 hover:bg-brand-700 mt-3 rounded-md px-3 py-1.5 text-sm font-medium text-white"
          >
            返回详情
          </button>
        </div>
      </AppPage>
    );
  }

  const customer = detail.project?.customer;

  return (
    <AppPage>
      <EntityFormWorkspace
        title={detail.approvalStatus === "REJECTED" ? "改稿报销申请" : "编辑报销申请"}
        description={detail.approvalStatus === "REJECTED" ? "修改后需重新提交审批" : "仅草稿/已驳回状态可编辑"}
        backHref={"/expenses/" + id}
        mode="edit"
        submitting={submitting}
        error={error}
        dirty={dirty}
        onDirty={() => setDirty(true)}
        onReload={handleReload}
        onSave={handleSave}
        onCancel={() => router.push("/expenses/" + id)}
      >
        <Section title="归属（客户 → 项目，锁定不可变更）">
          <FormField label="客户">
            <input value={customer ? customer.name ?? customer.code ?? "—" : "—"} readOnly disabled className={inputClass} />
          </FormField>
          <FormField label="项目">
            <input
              value={detail.project ? detail.project.name ?? detail.project.code ?? "—" : "—"}
              readOnly
              disabled
              className={inputClass}
            />
          </FormField>
          <p className="text-ink-muted md:col-span-2 mt-1 text-xs">
            报销申请直接挂在项目下，归属不可改挂；如需改挂项目请删除后重新创建。
          </p>
        </Section>
        <Section title="费用信息">
          <FormField label="费用类型">
            <input
              value={expenseType}
              onChange={(e) => setExpenseType(e.target.value)}
              maxLength={50}
              list="expense-type-suggestions"
              placeholder="如：差旅 / 业务招待 / 办公"
              className={inputClass}
            />
            <datalist id="expense-type-suggestions">
              {EXPENSE_TYPE_SUGGESTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </FormField>
          <FormField label="费用归属">
            <select value={expenseAttribution} onChange={(e) => setExpenseAttribution(e.target.value)} className={inputClass}>
              <option value="">请选择归属</option>
              {EXPENSE_ATTRIBUTION_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="费用科目" required>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              maxLength={100}
              list="expense-category-suggestions"
              placeholder="如：差旅费 / 交通费 / 办公费"
              className={inputClass}
            />
            <datalist id="expense-category-suggestions">
              {CATEGORY_SUGGESTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </FormField>
          <FormField label="金额" required>
            <input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
          </FormField>
          <FormField label="币种">
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={10} className={inputClass} />
          </FormField>
          <FormField label="发生日期">
            <input type="date" value={incurredAt} onChange={(e) => setIncurredAt(e.target.value)} className={inputClass} />
          </FormField>
          <FormField label="备注" hint="最多 500 字">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="费用说明（可选）"
              className={inputClass}
            />
          </FormField>
        </Section>
        {detail.approvalStatus === "REJECTED" && detail.rejectionReason ? (
          <section className="border-status-danger-border bg-status-danger-bg/40 rounded-md border p-4">
            <h2 className="text-status-danger-text mb-2 text-sm font-semibold">驳回原因（改稿请对照修改）</h2>
            <p className="text-status-danger-text whitespace-pre-wrap text-sm">{detail.rejectionReason}</p>
          </section>
        ) : null}
      </EntityFormWorkspace>
    </AppPage>
  );
}

export default function Page() {
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canEdit = hasPermission(roles, actionPermission("project-expense", "edit"));
  return (
    <PermissionGuard permission={actionPermission("project-expense", "view")}>
      {canEdit ? (
        <ExpenseEditForm />
      ) : (
        <AppPage>
          <div className="border-border bg-surface rounded-lg border p-6 text-sm text-ink-secondary">
            无编辑权限
          </div>
        </AppPage>
      )}
    </PermissionGuard>
  );
}
