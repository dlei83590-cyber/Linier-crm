"use client";

/** GL 手工记账凭证 — 新建页（Sprint 7 Finance，ADR-0035；DRAFT 不占号；借贷平衡实时校验；maker-checker 在审核/过账强制） */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { AppPage, EntityFormWorkspace } from "@/components/workspace";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS } from "@/lib/ui-classes";

interface AccountOption { id: string; code: string; name: string; category: string; direction: string; }
interface LineRow { accountCode: string; debit: string; credit: string; summary: string; }

const inputClass = INPUT_CLASS;

function ManualEntryForm() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [postingDate, setPostingDate] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState("");
  const [lines, setLines] = useState<LineRow[]>([
    { accountCode: "", debit: "", credit: "", summary: "" },
    { accountCode: "", debit: "", credit: "", summary: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (accountsLoaded) return;
    apiFetch<AccountOption[]>("/api/gl/accounts")
      .then((body) => { setAccounts(body.data); setAccountsLoaded(true); })
      .catch(() => setAccountsLoaded(true));
  }, [accountsLoaded]);

  const totalDebit = lines.reduce((acc, l) => acc + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((acc, l) => acc + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.001;

  const updateLine = (i: number, patch: Partial<LineRow>) => {
    setDirty(true);
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, { accountCode: "", debit: "", credit: "", summary: "" }]);
  const removeLine = (i: number) => setLines((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev));

  const handleSave = () => {
    if (submitting) return;
    if (!postingDate || !summary.trim()) {
      setError(new ApiClientError(400, "过账日期与摘要为必填项", "VALIDATION"));
      return;
    }
    if (!balanced) {
      setError(new ApiClientError(400, "借贷不平衡（Σ借方 ≠ Σ贷方），拒绝创建", "VALIDATION"));
      return;
    }
    const validLines = lines.filter((l) => l.accountCode && (Number(l.debit) || Number(l.credit)));
    if (validLines.length < 2) {
      setError(new ApiClientError(400, "至少两行有效借贷分录", "VALIDATION"));
      return;
    }
    setSubmitting(true);
    setError(null);
    apiFetch<{ id: string }>("/api/gl/journal-entries/manual", {
      method: "POST",
      body: JSON.stringify({
        postingDate,
        summary: summary.trim(),
        lines: validLines.map((l) => ({ accountCode: l.accountCode, debit: Number(l.debit) ? String(Number(l.debit).toFixed(2)) : undefined, credit: Number(l.credit) ? String(Number(l.credit).toFixed(2)) : undefined, summary: l.summary || undefined })),
      }),
    })
      .then((body) => router.push(`/finance/gl-journal-entries/${body.data.id}`))
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err : new ApiClientError(0, "网络错误", "NETWORK_ERROR"));
        setSubmitting(false);
      });
  };

  return (
    <EntityFormWorkspace
      title="新建手工记账凭证"
      description="DRAFT 不占号（过账时取号）；借贷平衡服务端校验；审核/过账执行 maker-checker（不能是创建人）"
      backHref="/finance/gl-journal-entries"
      mode="create"
      submitting={submitting}
      error={error}
      dirty={dirty}
      onDirty={() => setDirty(true)}
      onSave={handleSave}
      onCancel={() => router.push("/finance/gl-journal-entries")}
    >
      <section className="rounded-md border border-border p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink-secondary">过账日期<span className="ml-0.5 text-status-danger-text">*</span></span>
            <input type="date" value={postingDate} onChange={(e) => { setPostingDate(e.target.value); setDirty(true); }} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-sm font-medium text-ink-secondary">摘要<span className="ml-0.5 text-status-danger-text">*</span></span>
            <input value={summary} onChange={(e) => { setSummary(e.target.value); setDirty(true); }} className={inputClass} placeholder="如：计提折旧 / 费用更正 / 杂项调整" />
          </label>
        </div>
      </section>
      <section className="rounded-md border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-primary">分录行（每行只填借方或贷方一侧）</h2>
          <div className="flex items-center gap-3 text-sm">
            <span>借方合计：<b>{totalDebit.toFixed(2)}</b></span>
            <span>贷方合计：<b>{totalCredit.toFixed(2)}</b></span>
            <span className={balanced ? "text-status-success-text" : "text-status-danger-text"}>{balanced ? "平衡 ✓" : "不平衡 ✗"}</span>
            <button type="button" onClick={addLine} className="rounded-md border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-canvas">+ 添加行</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="text-left text-xs font-medium text-ink-secondary"><tr><th className="px-3 py-2">科目</th><th className="px-3 py-2">摘要</th><th className="px-3 py-2">借方金额</th><th className="px-3 py-2">贷方金额</th><th className="px-3 py-2"></th></tr></thead>
            <tbody className="divide-y divide-border">
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">
                    <select value={l.accountCode} onChange={(e) => updateLine(i, { accountCode: e.target.value })} className={inputClass}>
                      <option value="">请选择科目</option>
                      {accounts.map((a) => (<option key={a.id} value={a.code}>{a.code} {a.name}</option>))}
                    </select>
                  </td>
                  <td className="px-3 py-2"><input value={l.summary} onChange={(e) => updateLine(i, { summary: e.target.value })} className={inputClass} /></td>
                  <td className="px-3 py-2"><input type="number" min={0} step="0.01" value={l.debit} disabled={Number(l.credit) > 0} onChange={(e) => updateLine(i, { debit: e.target.value, credit: Number(e.target.value) > 0 ? "" : l.credit })} className={inputClass} /></td>
                  <td className="px-3 py-2"><input type="number" min={0} step="0.01" value={l.credit} disabled={Number(l.debit) > 0} onChange={(e) => updateLine(i, { credit: e.target.value, debit: Number(e.target.value) > 0 ? "" : l.debit })} className={inputClass} /></td>
                  <td className="px-3 py-2"><button type="button" onClick={() => removeLine(i)} disabled={lines.length <= 2} className="text-xs text-status-danger-text disabled:opacity-30">移除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </EntityFormWorkspace>
  );
}

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("gl", "create")}>
      <AppPage><ManualEntryForm /></AppPage>
    </PermissionGuard>
  );
}