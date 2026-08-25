"use client";

/**
 * SupplierProfile — Customer 360「供应商档案」Tab（FRT-02 前端生产可操作性）
 *
 * 后端已提供可写 contract（Sprint 3C-2 Supplier Foundation）：
 *   PATCH /api/suppliers/:id                         基础档案（status/rating/交期/起订量/优选）
 *   GET|POST /api/suppliers/:id/credit               信用评级（PartnerCredit upsert）
 *   GET|POST /api/suppliers/:id/settlements          账期结算（+ PATCH/DELETE :settlementId）
 *   GET|POST /api/suppliers/:id/qualifications       资质证书（+ PATCH/DELETE :qualId）
 * 本组件只消费上述既有 API（零新 Schema / 零新表），全部区块带 loading / error / empty 三态，
 * 失败展示真实 ApiClientError 可重试，权限不足不渲染按钮。
 *
 * 红线：不在此创建 Supplier 行（供应商建档由供应商主数据/采购流程负责）；
 *       不修改 activity-timeline（FRT-04 独占）。
 */
import { useCallback, useEffect, useState } from "react";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { INPUT_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";

const SUPPLIER_STATUS_LABELS: Record<string, string> = {
  POTENTIAL: "潜在", QUALIFIED: "合格", PREFERRED: "优选", SUSPENDED: "暂停", BLACKLISTED: "黑名单",
};
const SUPPLIER_STATUS_OPTIONS = Object.keys(SUPPLIER_STATUS_LABELS);
const QUAL_TYPE_LABELS: Record<string, string> = {
  BUSINESS_LICENSE: "营业执照", ISO9001: "ISO9001", ISO14001: "ISO14001", IATF16949: "IATF16949",
  CE: "CE", ROHS: "RoHS", OTHER: "其他",
};
const QUAL_TYPE_OPTIONS = Object.keys(QUAL_TYPE_LABELS);
const QUAL_STATUS_LABELS: Record<string, string> = { VALID: "有效", EXPIRING: "临期", EXPIRED: "已过期" };
const QUAL_STATUS_OPTIONS = Object.keys(QUAL_STATUS_LABELS);
const CREDIT_RATING_LABELS: Record<string, string> = { AAA: "AAA", AA: "AA", A: "A", BBB: "BBB", BB: "BB", B: "B", C: "C" };
const CREDIT_RATING_OPTIONS = Object.keys(CREDIT_RATING_LABELS);
const CREDIT_STATUS_LABELS: Record<string, string> = { NORMAL: "正常", WATCH: "关注", FROZEN: "冻结", CLOSED: "关闭" };
const CREDIT_STATUS_OPTIONS = Object.keys(CREDIT_STATUS_LABELS);
const PAYMENT_METHOD_OPTIONS = ["TT", "LC", "DP", "DA"];

interface SupplierProfileRow {
  id: string; code: string; name: string; status: string; rating: number | null;
  defaultLeadTime: number | null; minOrderQty: string | null; currency: string;
  isPreferred: boolean; version: number;
}

interface QualificationRow {
  id: string; qualType: string; qualName: string; certNo: string | null;
  issueDate: string | null; expireDate: string | null; status: string; version: number;
}

interface SettlementRow {
  id: string; paymentTerms: string | null; creditDays: number | null;
  paymentMethod: string | null; currency: string; version: number;
}

interface CreditRow {
  id: string; creditLimit: string | null; usedCredit: string | null;
  rating: string; status: string; reviewDate: string | null; version: number;
}

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function dateToIso(value: string): string | undefined {
  const t = value.trim();
  if (!t) return undefined;
  const d = new Date(t + "T00:00:00.000Z");
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function errText(err: unknown, fallback: string): string {
  return err instanceof ApiClientError ? err.message : fallback;
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink-primary">{title}</h3>
      {children}
    </section>
  );
}

function StatusLine({ loading, error, empty, emptyText, onRetry }: { loading: boolean; error: string | null; empty: boolean; emptyText: string; onRetry: () => void }) {
  if (loading) return <p className="text-sm text-ink-muted">加载中…</p>;
  if (error) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-sm text-status-danger-text">{error}</p>
        <button type="button" onClick={onRetry} className={BUTTON_SECONDARY_CLASS + " text-xs"}>重试</button>
      </div>
    );
  }
  if (empty) return <p className="text-sm text-ink-muted">{emptyText}</p>;
  return null;
}

export function SupplierProfile({ supplierId, onChanged }: { supplierId: string; onChanged?: () => void }) {
  const toast = useToast();
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canViewBase = hasPermission(roles, actionPermission("supplier", "view"));
  const canEditBase = hasPermission(roles, actionPermission("supplier", "edit"));
  const canViewCredit = hasPermission(roles, actionPermission("partner-credit", "view"));
  const canEditCredit = hasPermission(roles, actionPermission("partner-credit", "create"));
  const canViewSettlement = hasPermission(roles, actionPermission("supplier-settlement", "view"));
  const canCreateSettlement = hasPermission(roles, actionPermission("supplier-settlement", "create"));
  const canEditSettlement = hasPermission(roles, actionPermission("supplier-settlement", "edit"));
  const canDeleteSettlement = hasPermission(roles, actionPermission("supplier-settlement", "delete"));
  const canViewQual = hasPermission(roles, actionPermission("supplier-qualification", "view"));
  const canCreateQual = hasPermission(roles, actionPermission("supplier-qualification", "create"));
  const canEditQual = hasPermission(roles, actionPermission("supplier-qualification", "edit"));
  const canDeleteQual = hasPermission(roles, actionPermission("supplier-qualification", "delete"));

  const [profile, setProfile] = useState<SupplierProfileRow | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [baseForm, setBaseForm] = useState<{ status: string; rating: string; defaultLeadTime: string; minOrderQty: string; currency: string; isPreferred: boolean }>({ status: "POTENTIAL", rating: "", defaultLeadTime: "", minOrderQty: "", currency: "CNY", isPreferred: false });
  const [baseSaving, setBaseSaving] = useState(false);

  const [credit, setCredit] = useState<CreditRow | null>(null);
  const [creditLoading, setCreditLoading] = useState(true);
  const [creditError, setCreditError] = useState<string | null>(null);
  const [creditForm, setCreditForm] = useState<{ creditLimit: string; rating: string; status: string; reviewDate: string }>({ creditLimit: "", rating: "B", status: "NORMAL", reviewDate: "" });
  const [creditSaving, setCreditSaving] = useState(false);

  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [settlementsLoading, setSettlementsLoading] = useState(true);
  const [settlementsError, setSettlementsError] = useState<string | null>(null);
  const [stForm, setStForm] = useState<{ paymentTerms: string; creditDays: string; paymentMethod: string; currency: string }>({ paymentTerms: "", creditDays: "", paymentMethod: "", currency: "CNY" });
  const [stSaving, setStSaving] = useState(false);
  const [editingSt, setEditingSt] = useState<string | null>(null);
  const [stEditForm, setStEditForm] = useState<{ paymentTerms: string; creditDays: string; paymentMethod: string; currency: string }>({ paymentTerms: "", creditDays: "", paymentMethod: "", currency: "CNY" });
  const [stEditSaving, setStEditSaving] = useState(false);
  const [confirmDeleteSt, setConfirmDeleteSt] = useState<string | null>(null);

  const [quals, setQuals] = useState<QualificationRow[]>([]);
  const [qualsLoading, setQualsLoading] = useState(true);
  const [qualsError, setQualsError] = useState<string | null>(null);
  const [qualForm, setQualForm] = useState<{ qualType: string; qualName: string; certNo: string; issueDate: string; expireDate: string; status: string }>({ qualType: "BUSINESS_LICENSE", qualName: "", certNo: "", issueDate: "", expireDate: "", status: "VALID" });
  const [qualSaving, setQualSaving] = useState(false);
  const [editingQual, setEditingQual] = useState<string | null>(null);
  const [qualEditForm, setQualEditForm] = useState<{ qualType: string; qualName: string; certNo: string; issueDate: string; expireDate: string; status: string }>({ qualType: "BUSINESS_LICENSE", qualName: "", certNo: "", issueDate: "", expireDate: "", status: "VALID" });
  const [qualEditSaving, setQualEditSaving] = useState(false);
  const [confirmDeleteQual, setConfirmDeleteQual] = useState<string | null>(null);

  const loadBase = useCallback(() => {
    setProfileLoading(true);
    setProfileError(null);
    apiFetch<SupplierProfileRow>("/api/suppliers/" + supplierId)
      .then((b) => {
        const p = b.data;
        setProfile(p);
        setBaseForm({
          status: p.status,
          rating: p.rating != null ? String(p.rating) : "",
          defaultLeadTime: p.defaultLeadTime != null ? String(p.defaultLeadTime) : "",
          minOrderQty: p.minOrderQty != null ? String(p.minOrderQty) : "",
          currency: p.currency || "CNY",
          isPreferred: p.isPreferred,
        });
      })
      .catch((err: unknown) => setProfileError(errText(err, "加载供应商档案失败")))
      .finally(() => setProfileLoading(false));
  }, [supplierId]);

  const loadCredit = useCallback(() => {
    setCreditLoading(true);
    setCreditError(null);
    apiFetch<CreditRow | null>("/api/suppliers/" + supplierId + "/credit")
      .then((b) => {
        const c = b.data;
        setCredit(c);
        setCreditForm({
          creditLimit: c?.creditLimit != null ? String(c.creditLimit) : "",
          rating: c?.rating ?? "B",
          status: c?.status ?? "NORMAL",
          reviewDate: toDateInput(c?.reviewDate),
        });
      })
      .catch((err: unknown) => setCreditError(errText(err, "加载信用评级失败")))
      .finally(() => setCreditLoading(false));
  }, [supplierId]);

  const loadSettlements = useCallback(() => {
    setSettlementsLoading(true);
    setSettlementsError(null);
    apiFetch<SettlementRow[]>("/api/suppliers/" + supplierId + "/settlements?pageSize=50")
      .then((b) => setSettlements(Array.isArray(b.data) ? b.data : []))
      .catch((err: unknown) => setSettlementsError(errText(err, "加载结算条款失败")))
      .finally(() => setSettlementsLoading(false));
  }, [supplierId]);

  const loadQuals = useCallback(() => {
    setQualsLoading(true);
    setQualsError(null);
    apiFetch<QualificationRow[]>("/api/suppliers/" + supplierId + "/qualifications?pageSize=50")
      .then((b) => setQuals(Array.isArray(b.data) ? b.data : []))
      .catch((err: unknown) => setQualsError(errText(err, "加载资质证书失败")))
      .finally(() => setQualsLoading(false));
  }, [supplierId]);

  useEffect(() => {
    loadBase();
    loadCredit();
    loadSettlements();
    loadQuals();
  }, [loadBase, loadCredit, loadSettlements, loadQuals]);

  const notifyChanged = () => onChanged?.();

  const saveBase = async () => {
    if (!profile || baseSaving) return;
    setBaseSaving(true);
    try {
      await apiFetch("/api/suppliers/" + supplierId, {
        method: "PATCH",
        body: JSON.stringify({
          version: profile.version,
          status: baseForm.status,
          rating: baseForm.rating === "" ? null : Number(baseForm.rating),
          defaultLeadTime: baseForm.defaultLeadTime === "" ? null : Number(baseForm.defaultLeadTime),
          minOrderQty: baseForm.minOrderQty === "" ? null : Number(baseForm.minOrderQty),
          currency: baseForm.currency.trim() || "CNY",
          isPreferred: baseForm.isPreferred,
        }),
      });
      toast.success("供应商档案已保存");
      loadBase();
      notifyChanged();
    } catch (err: unknown) {
      toast.error("保存失败", errText(err, "网络错误"));
    } finally {
      setBaseSaving(false);
    }
  };

  const saveCredit = async () => {
    if (creditSaving) return;
    setCreditSaving(true);
    try {
      const reviewIso = dateToIso(creditForm.reviewDate);
      const body: Record<string, unknown> = {
        rating: creditForm.rating,
        status: creditForm.status,
        reviewDate: reviewIso,
      };
      if (creditForm.creditLimit.trim() !== "") body.creditLimit = Number(creditForm.creditLimit);
      if (credit && credit.version) body.version = credit.version;
      await apiFetch("/api/suppliers/" + supplierId + "/credit", { method: "POST", body: JSON.stringify(body) });
      toast.success(credit ? "信用评级已更新" : "信用评级已创建");
      loadCredit();
      notifyChanged();
    } catch (err: unknown) {
      toast.error("保存信用评级失败", errText(err, "网络错误"));
    } finally {
      setCreditSaving(false);
    }
  };

  const addSettlement = async () => {
    if (stSaving) return;
    setStSaving(true);
    try {
      await apiFetch("/api/suppliers/" + supplierId + "/settlements", {
        method: "POST",
        body: JSON.stringify({
          paymentTerms: stForm.paymentTerms.trim() || undefined,
          creditDays: stForm.creditDays === "" ? undefined : Number(stForm.creditDays),
          paymentMethod: stForm.paymentMethod.trim() || undefined,
          currency: stForm.currency.trim() || undefined,
        }),
      });
      toast.success("结算条款已添加");
      setStForm({ paymentTerms: "", creditDays: "", paymentMethod: "", currency: "CNY" });
      loadSettlements();
      notifyChanged();
    } catch (err: unknown) {
      toast.error("添加结算条款失败", errText(err, "网络错误"));
    } finally {
      setStSaving(false);
    }
  };

  const openStEdit = (s: SettlementRow) => {
    setEditingSt(s.id);
    setStEditForm({
      paymentTerms: s.paymentTerms ?? "",
      creditDays: s.creditDays != null ? String(s.creditDays) : "",
      paymentMethod: s.paymentMethod ?? "",
      currency: s.currency,
    });
  };

  const saveStEdit = async (s: SettlementRow) => {
    if (stEditSaving) return;
    setStEditSaving(true);
    try {
      await apiFetch("/api/suppliers/" + supplierId + "/settlements/" + s.id, {
        method: "PATCH",
        body: JSON.stringify({
          version: s.version,
          paymentTerms: stEditForm.paymentTerms.trim() || null,
          creditDays: stEditForm.creditDays === "" ? null : Number(stEditForm.creditDays),
          paymentMethod: stEditForm.paymentMethod.trim() || null,
          currency: stEditForm.currency.trim() || s.currency,
        }),
      });
      toast.success("结算条款已更新");
      setEditingSt(null);
      loadSettlements();
      notifyChanged();
    } catch (err: unknown) {
      toast.error("更新结算条款失败", errText(err, "网络错误"));
    } finally {
      setStEditSaving(false);
    }
  };

  const deleteSettlement = async (s: SettlementRow) => {
    try {
      await apiFetch("/api/suppliers/" + supplierId + "/settlements/" + s.id, { method: "DELETE" });
      toast.success("结算条款已删除");
      setConfirmDeleteSt(null);
      loadSettlements();
      notifyChanged();
    } catch (err: unknown) {
      toast.error("删除结算条款失败", errText(err, "网络错误"));
      setConfirmDeleteSt(null);
    }
  };

  const addQual = async () => {
    if (qualSaving) return;
    if (!qualForm.qualName.trim()) {
      toast.error("资质名称必填", "请填写资质名称");
      return;
    }
    setQualSaving(true);
    try {
      await apiFetch("/api/suppliers/" + supplierId + "/qualifications", {
        method: "POST",
        body: JSON.stringify({
          qualType: qualForm.qualType,
          qualName: qualForm.qualName.trim(),
          certNo: qualForm.certNo.trim() || undefined,
          issueDate: dateToIso(qualForm.issueDate),
          expireDate: dateToIso(qualForm.expireDate),
          status: qualForm.status,
        }),
      });
      toast.success("资质证书已添加");
      setQualForm({ qualType: "BUSINESS_LICENSE", qualName: "", certNo: "", issueDate: "", expireDate: "", status: "VALID" });
      loadQuals();
      notifyChanged();
    } catch (err: unknown) {
      toast.error("添加资质失败", errText(err, "网络错误"));
    } finally {
      setQualSaving(false);
    }
  };

  const openQualEdit = (q: QualificationRow) => {
    setEditingQual(q.id);
    setQualEditForm({
      qualType: q.qualType,
      qualName: q.qualName,
      certNo: q.certNo ?? "",
      issueDate: toDateInput(q.issueDate),
      expireDate: toDateInput(q.expireDate),
      status: q.status,
    });
  };

  const saveQualEdit = async (q: QualificationRow) => {
    if (qualEditSaving) return;
    setQualEditSaving(true);
    try {
      await apiFetch("/api/suppliers/" + supplierId + "/qualifications/" + q.id, {
        method: "PATCH",
        body: JSON.stringify({
          version: q.version,
          qualType: qualEditForm.qualType,
          qualName: qualEditForm.qualName.trim(),
          certNo: qualEditForm.certNo.trim() || null,
          issueDate: dateToIso(qualEditForm.issueDate) ?? null,
          expireDate: dateToIso(qualEditForm.expireDate) ?? null,
          status: qualEditForm.status,
        }),
      });
      toast.success("资质已更新");
      setEditingQual(null);
      loadQuals();
      notifyChanged();
    } catch (err: unknown) {
      toast.error("更新资质失败", errText(err, "网络错误"));
    } finally {
      setQualEditSaving(false);
    }
  };

  const deleteQual = async (q: QualificationRow) => {
    try {
      await apiFetch("/api/suppliers/" + supplierId + "/qualifications/" + q.id, { method: "DELETE" });
      toast.success("资质已删除");
      setConfirmDeleteQual(null);
      loadQuals();
      notifyChanged();
    } catch (err: unknown) {
      toast.error("删除资质失败", errText(err, "网络错误"));
      setConfirmDeleteQual(null);
    }
  };

  if (!canViewBase && !canViewCredit && !canViewSettlement && !canViewQual) {
    return <p className="text-sm text-ink-muted">无查看供应商档案权限。</p>;
  }

  return (
    <div className="space-y-4">
      <SectionCard title="基础档案">
        {profileLoading || profileError || !profile ? (
          <StatusLine loading={profileLoading} error={profileError} empty={!profile} emptyText="暂无供应商档案（供应商建档由采购流程/供应商主数据负责）" onRetry={loadBase} />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <label className="block">
                <span className="block text-xs text-ink-secondary">供应商状态</span>
                <select value={baseForm.status} disabled={!canEditBase} onChange={(e) => setBaseForm({ ...baseForm, status: e.target.value })} className={INPUT_CLASS}>
                  {SUPPLIER_STATUS_OPTIONS.map((v) => <option key={v} value={v}>{SUPPLIER_STATUS_LABELS[v]}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs text-ink-secondary">资质评级（1-5 星）</span>
                <select value={baseForm.rating} disabled={!canEditBase} onChange={(e) => setBaseForm({ ...baseForm, rating: e.target.value })} className={INPUT_CLASS}>
                  <option value="">未评级</option>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs text-ink-secondary">默认交期（天）</span>
                <input type="number" min={1} value={baseForm.defaultLeadTime} disabled={!canEditBase} onChange={(e) => setBaseForm({ ...baseForm, defaultLeadTime: e.target.value })} className={INPUT_CLASS} />
              </label>
              <label className="block">
                <span className="block text-xs text-ink-secondary">最小起订量</span>
                <input type="number" min={0} value={baseForm.minOrderQty} disabled={!canEditBase} onChange={(e) => setBaseForm({ ...baseForm, minOrderQty: e.target.value })} className={INPUT_CLASS} />
              </label>
              <label className="block">
                <span className="block text-xs text-ink-secondary">币种</span>
                <input value={baseForm.currency} disabled={!canEditBase} onChange={(e) => setBaseForm({ ...baseForm, currency: e.target.value })} className={INPUT_CLASS} maxLength={10} />
              </label>
              <label className="flex items-center gap-2 pt-5">
                <input type="checkbox" checked={baseForm.isPreferred} disabled={!canEditBase} onChange={(e) => setBaseForm({ ...baseForm, isPreferred: e.target.checked })} className="h-3.5 w-3.5" />
                <span className="text-xs text-ink-secondary">优选供应商</span>
              </label>
            </div>
            {canEditBase && (
              <div className="flex items-center justify-end">
                <button type="button" onClick={saveBase} disabled={baseSaving} className={BUTTON_PRIMARY_CLASS + " text-xs"}>
                  {baseSaving ? "保存中…" : "保存档案"}
                </button>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard title="信用评级">
        <StatusLine loading={creditLoading} error={creditError} empty={false} emptyText="" onRetry={loadCredit} />
        {!creditLoading && !creditError && (
          canViewCredit ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <label className="block">
                  <span className="block text-xs text-ink-secondary">信用额度（元）</span>
                  <input type="number" min={0} value={creditForm.creditLimit} disabled={!canEditCredit} onChange={(e) => setCreditForm({ ...creditForm, creditLimit: e.target.value })} className={INPUT_CLASS} placeholder="如 100000" />
                </label>
                <label className="block">
                  <span className="block text-xs text-ink-secondary">信用等级</span>
                  <select value={creditForm.rating} disabled={!canEditCredit} onChange={(e) => setCreditForm({ ...creditForm, rating: e.target.value })} className={INPUT_CLASS}>
                    {CREDIT_RATING_OPTIONS.map((v) => <option key={v} value={v}>{CREDIT_RATING_LABELS[v]}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs text-ink-secondary">信用状态</span>
                  <select value={creditForm.status} disabled={!canEditCredit} onChange={(e) => setCreditForm({ ...creditForm, status: e.target.value })} className={INPUT_CLASS}>
                    {CREDIT_STATUS_OPTIONS.map((v) => <option key={v} value={v}>{CREDIT_STATUS_LABELS[v]}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs text-ink-secondary">复核日期</span>
                  <input type="date" value={creditForm.reviewDate} disabled={!canEditCredit} onChange={(e) => setCreditForm({ ...creditForm, reviewDate: e.target.value })} className={INPUT_CLASS} />
                </label>
              </div>
              {credit && (
                <p className="text-xs text-ink-muted">已用额度：{credit.usedCredit != null ? credit.usedCredit : "—"} 元（只读，由应收占用维护）</p>
              )}
              {canEditCredit && (
                <div className="flex items-center justify-end">
                  <button type="button" onClick={saveCredit} disabled={creditSaving} className={BUTTON_PRIMARY_CLASS + " text-xs"}>
                    {creditSaving ? "保存中…" : credit ? "更新信用" : "创建信用"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">{credit ? `信用等级 ${CREDIT_RATING_LABELS[credit.rating] ?? credit.rating} · ${CREDIT_STATUS_LABELS[credit.status] ?? credit.status}` : "暂无信用记录。"}</p>
          )
        )}
      </SectionCard>

      <SectionCard title="账期结算">
        <StatusLine loading={settlementsLoading} error={settlementsError} empty={settlements.length === 0} emptyText="暂无结算条款。" onRetry={loadSettlements} />
        {!settlementsLoading && !settlementsError && settlements.length > 0 && (
          <div className="mb-3 space-y-2">
            {settlements.map((s) => (
              <div key={s.id} className="rounded-md border border-border p-2">
                {editingSt === s.id && canEditSettlement ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <input value={stEditForm.paymentTerms} onChange={(e) => setStEditForm({ ...stEditForm, paymentTerms: e.target.value })} className={INPUT_CLASS + " w-36"} placeholder="付款条款 NET30" />
                    <input type="number" min={0} value={stEditForm.creditDays} onChange={(e) => setStEditForm({ ...stEditForm, creditDays: e.target.value })} className={INPUT_CLASS + " w-24"} placeholder="账期天数" />
                    <select value={stEditForm.paymentMethod} onChange={(e) => setStEditForm({ ...stEditForm, paymentMethod: e.target.value })} className={INPUT_CLASS + " w-24"}>
                      <option value="">付款方式</option>
                      {PAYMENT_METHOD_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <input value={stEditForm.currency} onChange={(e) => setStEditForm({ ...stEditForm, currency: e.target.value })} className={INPUT_CLASS + " w-20"} maxLength={10} />
                    <button type="button" onClick={() => saveStEdit(s)} disabled={stEditSaving} className={BUTTON_PRIMARY_CLASS + " text-xs"}>保存</button>
                    <button type="button" onClick={() => setEditingSt(null)} className={BUTTON_SECONDARY_CLASS + " text-xs"}>取消</button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="text-ink-primary">{s.paymentTerms ?? "—"}</span>
                    <span className="text-xs text-ink-secondary">账期 {s.creditDays != null ? s.creditDays + " 天" : "—"}</span>
                    <span className="text-xs text-ink-secondary">{s.paymentMethod ?? "—"} · {s.currency}</span>
                    <div className="ml-auto flex items-center gap-1">
                      {canEditSettlement && <button type="button" onClick={() => openStEdit(s)} className={BUTTON_SECONDARY_CLASS + " text-xs"}>编辑</button>}
                      {canDeleteSettlement && (
                        confirmDeleteSt === s.id ? (
                          <>
                            <button type="button" onClick={() => deleteSettlement(s)} className="rounded-md bg-status-danger-text px-2 py-1 text-xs font-medium text-white">确认删除</button>
                            <button type="button" onClick={() => setConfirmDeleteSt(null)} className={BUTTON_SECONDARY_CLASS + " text-xs"}>取消</button>
                          </>
                        ) : (
                          <button type="button" onClick={() => setConfirmDeleteSt(s.id)} className={BUTTON_SECONDARY_CLASS + " text-xs text-status-danger-text"}>删除</button>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {!settlementsLoading && !settlementsError && canCreateSettlement && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
            <input value={stForm.paymentTerms} onChange={(e) => setStForm({ ...stForm, paymentTerms: e.target.value })} className={INPUT_CLASS + " w-36"} placeholder="付款条款 NET30" />
            <input type="number" min={0} value={stForm.creditDays} onChange={(e) => setStForm({ ...stForm, creditDays: e.target.value })} className={INPUT_CLASS + " w-24"} placeholder="账期天数" />
            <select value={stForm.paymentMethod} onChange={(e) => setStForm({ ...stForm, paymentMethod: e.target.value })} className={INPUT_CLASS + " w-24"}>
              <option value="">付款方式</option>
              {PAYMENT_METHOD_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <input value={stForm.currency} onChange={(e) => setStForm({ ...stForm, currency: e.target.value })} className={INPUT_CLASS + " w-20"} maxLength={10} />
            <button type="button" onClick={addSettlement} disabled={stSaving} className={BUTTON_PRIMARY_CLASS + " text-xs"}>添加结算条款</button>
          </div>
        )}
      </SectionCard>

      <SectionCard title="资质证书">
        <StatusLine loading={qualsLoading} error={qualsError} empty={quals.length === 0} emptyText="暂无资质记录。" onRetry={loadQuals} />
        {!qualsLoading && !qualsError && quals.length > 0 && (
          <div className="mb-3 space-y-2">
            {quals.map((q) => (
              <div key={q.id} className="rounded-md border border-border p-2">
                {editingQual === q.id && canEditQual ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <select value={qualEditForm.qualType} onChange={(e) => setQualEditForm({ ...qualEditForm, qualType: e.target.value })} className={INPUT_CLASS + " w-36"}>
                      {QUAL_TYPE_OPTIONS.map((v) => <option key={v} value={v}>{QUAL_TYPE_LABELS[v]}</option>)}
                    </select>
                    <input value={qualEditForm.qualName} onChange={(e) => setQualEditForm({ ...qualEditForm, qualName: e.target.value })} className={INPUT_CLASS + " w-44"} placeholder="资质名称 *" />
                    <input value={qualEditForm.certNo} onChange={(e) => setQualEditForm({ ...qualEditForm, certNo: e.target.value })} className={INPUT_CLASS + " w-32"} placeholder="证书编号" />
                    <input type="date" value={qualEditForm.issueDate} onChange={(e) => setQualEditForm({ ...qualEditForm, issueDate: e.target.value })} className={INPUT_CLASS + " w-36"} />
                    <input type="date" value={qualEditForm.expireDate} onChange={(e) => setQualEditForm({ ...qualEditForm, expireDate: e.target.value })} className={INPUT_CLASS + " w-36"} />
                    <select value={qualEditForm.status} onChange={(e) => setQualEditForm({ ...qualEditForm, status: e.target.value })} className={INPUT_CLASS + " w-24"}>
                      {QUAL_STATUS_OPTIONS.map((v) => <option key={v} value={v}>{QUAL_STATUS_LABELS[v]}</option>)}
                    </select>
                    <button type="button" onClick={() => saveQualEdit(q)} disabled={qualEditSaving} className={BUTTON_PRIMARY_CLASS + " text-xs"}>保存</button>
                    <button type="button" onClick={() => setEditingQual(null)} className={BUTTON_SECONDARY_CLASS + " text-xs"}>取消</button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="font-medium text-ink-primary">{QUAL_TYPE_LABELS[q.qualType] ?? q.qualType}</span>
                    <span className="text-ink-primary">{q.qualName}</span>
                    <span className="text-xs text-ink-secondary">{q.certNo ? "证书号 " + q.certNo : ""}</span>
                    <span className="text-xs text-ink-secondary">{q.issueDate ? "发证 " + formatDate(q.issueDate) : ""}</span>
                    <span className="text-xs text-ink-secondary">{q.expireDate ? "有效至 " + formatDate(q.expireDate) : ""}</span>
                    <span className="text-xs">{QUAL_STATUS_LABELS[q.status] ?? q.status}</span>
                    <div className="ml-auto flex items-center gap-1">
                      {canEditQual && <button type="button" onClick={() => openQualEdit(q)} className={BUTTON_SECONDARY_CLASS + " text-xs"}>编辑</button>}
                      {canDeleteQual && (
                        confirmDeleteQual === q.id ? (
                          <>
                            <button type="button" onClick={() => deleteQual(q)} className="rounded-md bg-status-danger-text px-2 py-1 text-xs font-medium text-white">确认删除</button>
                            <button type="button" onClick={() => setConfirmDeleteQual(null)} className={BUTTON_SECONDARY_CLASS + " text-xs"}>取消</button>
                          </>
                        ) : (
                          <button type="button" onClick={() => setConfirmDeleteQual(q.id)} className={BUTTON_SECONDARY_CLASS + " text-xs text-status-danger-text"}>删除</button>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {!qualsLoading && !qualsError && canCreateQual && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
            <select value={qualForm.qualType} onChange={(e) => setQualForm({ ...qualForm, qualType: e.target.value })} className={INPUT_CLASS + " w-36"}>
              {QUAL_TYPE_OPTIONS.map((v) => <option key={v} value={v}>{QUAL_TYPE_LABELS[v]}</option>)}
            </select>
            <input value={qualForm.qualName} onChange={(e) => setQualForm({ ...qualForm, qualName: e.target.value })} className={INPUT_CLASS + " w-44"} placeholder="资质名称 *" />
            <input value={qualForm.certNo} onChange={(e) => setQualForm({ ...qualForm, certNo: e.target.value })} className={INPUT_CLASS + " w-32"} placeholder="证书编号" />
            <input type="date" value={qualForm.issueDate} onChange={(e) => setQualForm({ ...qualForm, issueDate: e.target.value })} className={INPUT_CLASS + " w-36"} />
            <input type="date" value={qualForm.expireDate} onChange={(e) => setQualForm({ ...qualForm, expireDate: e.target.value })} className={INPUT_CLASS + " w-36"} />
            <select value={qualForm.status} onChange={(e) => setQualForm({ ...qualForm, status: e.target.value })} className={INPUT_CLASS + " w-24"}>
              {QUAL_STATUS_OPTIONS.map((v) => <option key={v} value={v}>{QUAL_STATUS_LABELS[v]}</option>)}
            </select>
            <button type="button" onClick={addQual} disabled={qualSaving} className={BUTTON_PRIMARY_CLASS + " text-xs"}>添加资质</button>
          </div>
        )}
      </SectionCard>
    </div>
  );
}