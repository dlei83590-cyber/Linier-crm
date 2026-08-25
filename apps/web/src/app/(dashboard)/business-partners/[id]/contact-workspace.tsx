"use client";

/**
 * ContactWorkspace — Customer 360 联系人管理（Phase 2A-2）
 *
 * 消费 2A-1 Backend API。主联系人只提交 isPrimary=true；编辑带 version；关系 target 排除自己；recurrence 透传；upcoming-reminders 展示服务端 nextOccurrence/remindAt。
 */
import { useEffect, useMemo, useState } from "react";
import { actionPermission, hasPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { ConfirmActionDialog } from "@/components/workspace";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { INPUT_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import {
  buildContactCreatePayload,
  buildContactEditPayload,
  buildSetPrimaryPayload,
  excludeSelf,
  buildSpecialDatePayload,
  type ContactFormValues,
} from "@/lib/contact/workspace-helpers";

interface ContactRow {
  id: string;
  name: string;
  title?: string | null;
  department?: string | null;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  wechat?: string | null;
  contactNote?: string | null;
  isPrimary: boolean;
  isActive: boolean;
  version: number;
  specialDates?: Array<{ id: string; type: string; date: string; recurrence: string; title?: string | null; remindDaysBefore: number; reminderEnabled: boolean }>;
}

interface ReminderRow { contactId: string; contactName: string; specialDateId: string; type: string; title: string | null; recurrence: string; nextOccurrence: string; remindAt: string; remindDaysBefore: number; }
interface RelationRow { id: string; relationType: string; note?: string | null; targetContact?: { id: string; name: string; title?: string | null } | null; }

const SPECIAL_TYPE_LABELS: Record<string, string> = { BIRTHDAY: "生日", ANNIVERSARY: "纪念日", OTHER: "其他" };
const RELATION_TYPE_LABELS: Record<string, string> = { COLLEAGUE: "同事", REPORTS_TO: "上级", DECISION_MAKER: "决策人", INFLUENCER: "影响者", RELATIVE: "亲属", OTHER: "其他" };
const inputClass = INPUT_CLASS;

export function ContactWorkspace({ partnerId }: { partnerId: string }) {
  const { state } = useSession();
  const roles = (state.user?.roles ?? []) as RoleCode[];
  const canView = hasPermission(roles, actionPermission("partner-contact", "view"));
  const canCreate = hasPermission(roles, actionPermission("partner-contact", "create"));
  const canEdit = hasPermission(roles, actionPermission("partner-contact", "edit"));
  const canDelete = hasPermission(roles, actionPermission("partner-contact", "delete"));
  const toast = useToast();

  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [form, setForm] = useState<ContactFormValues>({ name: "" });
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [relations, setRelations] = useState<RelationRow[]>([]);
  const [relationTargetId, setRelationTargetId] = useState("");
  const [relationType, setRelationType] = useState("COLLEAGUE");
  const [relationNote, setRelationNote] = useState("");
  const [relationSubmitting, setRelationSubmitting] = useState(false);
  const [sdType, setSdType] = useState("BIRTHDAY");
  const [sdDate, setSdDate] = useState("");
  const [sdRecurrence, setSdRecurrence] = useState<"NONE" | "YEARLY" | "">("");
  const [sdTitle, setSdTitle] = useState("");
  const [sdRemindDays, setSdRemindDays] = useState("0");
  const [sdSubmitting, setSdSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContactRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [primaryTarget, setPrimaryTarget] = useState<ContactRow | null>(null);

  const load = () => {
    setLoading(true);
    apiFetch<ContactRow[]>("/api/business-partners/" + partnerId + "/contacts?pageSize=100")
      .then((b) => { setContacts(Array.isArray(b.data) ? b.data : []); setLoadError(null); })
      .catch((err: unknown) => setLoadError(err instanceof ApiClientError ? err : new ApiClientError(0, "加载联系人失败", "NETWORK_ERROR")))
      .finally(() => setLoading(false));
    apiFetch<ReminderRow[]>("/api/business-partners/" + partnerId + "/contacts/upcoming-reminders?windowDays=30")
      .then((b) => setReminders(Array.isArray(b.data) ? b.data : []))
      .catch(() => setReminders([]));
  };
  useEffect(load, [partnerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRelations = (contactId: string) => {
    apiFetch<RelationRow[]>("/api/business-partners/" + partnerId + "/contacts/" + contactId + "/relations")
      .then((b) => setRelations(Array.isArray(b.data) ? b.data : []))
      .catch(() => setRelations([]));
  };

  const toggleExpand = (c: ContactRow) => {
    if (expandedId === c.id) { setExpandedId(null); } else { setExpandedId(c.id); loadRelations(c.id); }
  };
  const openCreate = () => { setEditing(null); setForm({ name: "" }); setFormOpen(true); };
  const openEdit = (c: ContactRow) => { setEditing(c); setForm({ name: c.name, title: c.title, department: c.department, phone: c.phone, mobile: c.mobile, email: c.email, wechat: c.wechat, contactNote: c.contactNote, isPrimary: c.isPrimary }); setFormOpen(true); };

  const submitForm = async () => {
    if (submitting || !form.name.trim()) return;
    setSubmitting(true);
    try {
      if (editing) {
        await apiFetch("/api/business-partners/" + partnerId + "/contacts/" + editing.id, { method: "PATCH", body: JSON.stringify(buildContactEditPayload(form, editing.version)) });
        toast.success("联系人已更新");
      } else {
        await apiFetch("/api/business-partners/" + partnerId + "/contacts", { method: "POST", body: JSON.stringify(buildContactCreatePayload(form)) });
        toast.success("联系人已创建");
      }
      setFormOpen(false); load();
    } catch (err) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "保存失败", "NETWORK_ERROR");
      toast.error(e.status === 409 ? "冲突或版本过期，请刷新后重试" : "保存失败", e.message);
    } finally { setSubmitting(false); }
  };

  const runSetPrimary = async () => {
    if (!primaryTarget) return;
    try {
      await apiFetch("/api/business-partners/" + partnerId + "/contacts/" + primaryTarget.id, { method: "PATCH", body: JSON.stringify(buildSetPrimaryPayload(primaryTarget.version)) });
      toast.success("已设为主联系人"); setPrimaryTarget(null); load();
    } catch (err) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "设置失败", "NETWORK_ERROR");
      toast.error(e.code === "CONTACT_PRIMARY_CONFLICT" ? "并发设置主联系人冲突，请刷新后重试" : "设置失败", e.message); setPrimaryTarget(null);
    }
  };

  const runDelete = async () => {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiFetch("/api/business-partners/" + partnerId + "/contacts/" + deleteTarget.id, { method: "DELETE" });
      toast.success("联系人已删除"); setDeleteTarget(null); load();
    } catch (err) {
      const e = err instanceof ApiClientError ? err : new ApiClientError(0, "删除失败", "NETWORK_ERROR");
      toast.error("删除失败", e.message); setDeleteTarget(null);
    } finally { setDeleteBusy(false); }
  };

  const submitSpecialDate = async (contactId: string) => {
    if (!sdDate || sdSubmitting) return;
    setSdSubmitting(true);
    try {
      await apiFetch("/api/business-partners/" + partnerId + "/contacts/" + contactId + "/special-dates", { method: "POST", body: JSON.stringify(buildSpecialDatePayload({ type: sdType as "BIRTHDAY" | "ANNIVERSARY" | "OTHER", date: sdDate, recurrence: sdRecurrence || undefined, title: sdTitle || null, remindDaysBefore: Number(sdRemindDays || 0), reminderEnabled: true })) });
      toast.success("特殊日期已添加"); setSdDate(""); setSdTitle(""); setSdRemindDays("0"); setSdRecurrence(""); load();
    } catch (err) { const e = err instanceof ApiClientError ? err : new ApiClientError(0, "添加失败", "NETWORK_ERROR"); toast.error("添加特殊日期失败", e.message); }
    finally { setSdSubmitting(false); }
  };

  const deleteSpecialDate = async (contactId: string, sdId: string) => {
    try { await apiFetch("/api/business-partners/" + partnerId + "/contacts/" + contactId + "/special-dates/" + sdId, { method: "DELETE" }); toast.success("特殊日期已删除"); load(); }
    catch (err) { const e = err instanceof ApiClientError ? err : new ApiClientError(0, "删除失败", "NETWORK_ERROR"); toast.error("删除特殊日期失败", e.message); }
  };

  const submitRelation = async (contactId: string) => {
    if (!relationTargetId || relationSubmitting) return;
    setRelationSubmitting(true);
    try {
      await apiFetch("/api/business-partners/" + partnerId + "/contacts/" + contactId + "/relations", { method: "POST", body: JSON.stringify({ targetContactId: relationTargetId, relationType, note: relationNote || null }) });
      toast.success("关系已建立"); setRelationTargetId(""); setRelationNote(""); loadRelations(contactId);
    } catch (err) { const e = err instanceof ApiClientError ? err : new ApiClientError(0, "建立关系失败", "NETWORK_ERROR"); toast.error("建立关系失败", e.message); }
    finally { setRelationSubmitting(false); }
  };

  const deleteRelation = async (contactId: string, relationId: string) => {
    try { await apiFetch("/api/business-partners/" + partnerId + "/contacts/" + contactId + "/relations/" + relationId, { method: "DELETE" }); toast.success("关系已删除"); loadRelations(contactId); }
    catch (err) { const e = err instanceof ApiClientError ? err : new ApiClientError(0, "删除失败", "NETWORK_ERROR"); toast.error("删除关系失败", e.message); }
  };

  // 2A-3：target selector 仅其他有效联系人（id !== self && isActive === true）
  const relationTargets = useMemo(
    () => excludeSelf(contacts, expandedId ?? "").filter((c) => c.isActive),
    [contacts, expandedId],
  );

  if (!canView) { return <p className="text-sm text-ink-muted">无查看联系人权限。</p>; }

  return (
    <div className="space-y-4">
      {reminders.length > 0 && (
        <section className="rounded-md border border-status-warning-border bg-status-warning-bg/40 p-4">
          <h3 className="mb-2 text-sm font-semibold text-ink-primary">即将到期提醒</h3>
          <ul className="space-y-1 text-sm">
            {reminders.map((r) => (
              <li key={r.specialDateId} className="flex items-center gap-2 text-ink-secondary">
                <span className="font-medium text-ink-primary">{r.contactName}</span>
                <span>{SPECIAL_TYPE_LABELS[r.type] ?? r.type}{r.title ? "·" + r.title : ""}</span>
                <span className="text-ink-muted">下次发生 {r.nextOccurrence} · 提醒 {r.remindAt}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-primary">联系人</h3>
        {canCreate && (<button type="button" onClick={openCreate} className={BUTTON_PRIMARY_CLASS}>+ 新增联系人</button>)}
      </div>

      {loading ? (
        <div className="mt-3 space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )
        : loadError ? (
          <div className="mt-3 flex flex-col items-center gap-2 rounded-lg border border-status-danger-border bg-status-danger-bg/30 py-8 text-center">
            <p className="text-sm text-status-danger-text">{loadError.message}</p>
            <button type="button" onClick={load} className={BUTTON_SECONDARY_CLASS + " text-xs"}>重试</button>
          </div>
        )
        : contacts.length === 0 ? (
          <EmptyState title="暂无联系人" description={canCreate ? "点击「+ 新增联系人」创建第一个联系人。" : "当前无可查看的联系人。"} />
        )
        : (
          <div className="mt-3 space-y-2">
            {contacts.map((c) => (
              <div key={c.id} className="rounded-lg border border-border bg-surface p-3.5 shadow-elevation-sm transition-shadow duration-150 hover:shadow-elevation-md">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => toggleExpand(c)} className="font-medium text-ink-primary hover:underline">{c.name}</button>
                  {c.isPrimary && <span className="rounded-full bg-domain-customer-project-50 px-2 py-0.5 text-xs font-medium text-domain-customer-project-700">主联系人</span>}
                  {!c.isActive && <span className="rounded-full bg-canvas px-2 py-0.5 text-xs text-ink-muted">已停用</span>}
                  {c.title && <span className="text-xs text-ink-secondary">{c.title}</span>}
                  {c.department && <span className="text-xs text-ink-secondary">{c.department}</span>}
                  <div className="ml-auto flex items-center gap-1">
                    {canEdit && !c.isPrimary && (<button type="button" onClick={() => setPrimaryTarget(c)} className={BUTTON_SECONDARY_CLASS + " text-xs"}>设为主联系人</button>)}
                    {canEdit && (<button type="button" onClick={() => openEdit(c)} className={BUTTON_SECONDARY_CLASS + " text-xs"}>编辑</button>)}
                    {canDelete && (<button type="button" onClick={() => setDeleteTarget(c)} className={BUTTON_SECONDARY_CLASS + " text-xs text-status-danger-text"}>删除</button>)}
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary">
                  {c.mobile && <span>手机 {c.mobile}</span>}
                  {c.phone && <span>电话 {c.phone}</span>}
                  {c.email && <span>邮箱 {c.email}</span>}
                  {c.wechat && <span>微信 {c.wechat}</span>}
                  {c.contactNote && <span>备注 {c.contactNote}</span>}
                </div>

                {expandedId === c.id && (
                  <div className="mt-3 space-y-3 border-t border-border pt-3">
                    <div>
                      <p className="mb-1 text-xs font-medium text-ink-secondary">特殊日期</p>
                      {(c.specialDates ?? []).map((sd) => (
                        <div key={sd.id} className="mb-1 flex items-center gap-2 text-xs text-ink-primary">
                          <span>{SPECIAL_TYPE_LABELS[sd.type] ?? sd.type}{sd.title ? "·" + sd.title : ""}</span>
                          <span className="text-ink-muted">{sd.date}（{sd.recurrence === "YEARLY" ? "每年" : "一次性"}）提前 {sd.remindDaysBefore} 天</span>
                          {canEdit && (<button type="button" onClick={() => deleteSpecialDate(c.id, sd.id)} className="text-status-danger-text hover:underline">删除</button>)}
                        </div>
                      ))}
                      {canEdit && (
                        <div className="flex flex-wrap items-end gap-2">
                          <select value={sdType} onChange={(e) => setSdType(e.target.value)} className={inputClass}><option value="BIRTHDAY">生日</option><option value="ANNIVERSARY">纪念日</option><option value="OTHER">其他</option></select>
                          <input type="date" value={sdDate} onChange={(e) => setSdDate(e.target.value)} className={inputClass} />
                          <select value={sdRecurrence} onChange={(e) => setSdRecurrence(e.target.value as "NONE" | "YEARLY" | "")} className={inputClass}><option value="">默认（生日/纪念日=每年）</option><option value="YEARLY">每年</option><option value="NONE">一次性</option></select>
                          <input value={sdRemindDays} onChange={(e) => setSdRemindDays(e.target.value)} className={"w-20 " + inputClass} placeholder="提前天数" />
                          <input value={sdTitle} onChange={(e) => setSdTitle(e.target.value)} className={inputClass} placeholder="标题（可空）" />
                          <button type="button" onClick={() => submitSpecialDate(c.id)} disabled={sdSubmitting} className="rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40">添加</button>
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="mb-1 text-xs font-medium text-ink-secondary">关系档案</p>
                      {relations.map((r) => (
                        <div key={r.id} className="mb-1 flex items-center gap-2 text-xs text-ink-primary">
                          <span>→ {r.targetContact?.name ?? "—"}</span>
                          <span className="text-ink-muted">{RELATION_TYPE_LABELS[r.relationType] ?? r.relationType}{r.note ? "（" + r.note + "）" : ""}</span>
                          {canEdit && (<button type="button" onClick={() => deleteRelation(c.id, r.id)} className="text-status-danger-text hover:underline">删除</button>)}
                        </div>
                      ))}
                      {canEdit && (
                        <div className="flex flex-wrap items-end gap-2">
                          <select value={relationTargetId} onChange={(e) => setRelationTargetId(e.target.value)} className={inputClass}><option value="">选择目标联系人</option>{relationTargets.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}</select>
                          <select value={relationType} onChange={(e) => setRelationType(e.target.value)} className={inputClass}>{Object.entries(RELATION_TYPE_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}</select>
                          <input value={relationNote} onChange={(e) => setRelationNote(e.target.value)} className={inputClass} placeholder="备注（可空）" />
                          <button type="button" onClick={() => submitRelation(c.id)} disabled={relationSubmitting} className="rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40">建立关系</button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

      {formOpen && (
        <div className="animate-fade-in rounded-lg border border-border bg-surface p-4 shadow-elevation-sm">
          <h3 className="mb-3 text-sm font-semibold text-ink-primary">{editing ? "编辑联系人" : "新增联系人"}</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <label className="block"><span className="block text-xs text-ink-secondary">姓名 *</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} /></label>
            <label className="block"><span className="block text-xs text-ink-secondary">职务</span><input value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputClass} /></label>
            <label className="block"><span className="block text-xs text-ink-secondary">部门</span><input value={form.department ?? ""} onChange={(e) => setForm({ ...form, department: e.target.value })} className={inputClass} /></label>
            <label className="block"><span className="block text-xs text-ink-secondary">手机</span><input value={form.mobile ?? ""} onChange={(e) => setForm({ ...form, mobile: e.target.value })} className={inputClass} /></label>
            <label className="block"><span className="block text-xs text-ink-secondary">电话</span><input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} /></label>
            <label className="block"><span className="block text-xs text-ink-secondary">邮箱</span><input value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} /></label>
            <label className="block"><span className="block text-xs text-ink-secondary">微信</span><input value={form.wechat ?? ""} onChange={(e) => setForm({ ...form, wechat: e.target.value })} className={inputClass} /></label>
            <label className="block col-span-2"><span className="block text-xs text-ink-secondary">联系备注</span><input value={form.contactNote ?? ""} onChange={(e) => setForm({ ...form, contactNote: e.target.value })} className={inputClass} /></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} /><span className="text-xs text-ink-secondary">设为主联系人</span></label>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setFormOpen(false)} className={BUTTON_SECONDARY_CLASS}>取消</button>
            <button type="button" onClick={submitForm} disabled={submitting} className={BUTTON_PRIMARY_CLASS}>{submitting ? "保存中…" : "保存"}</button>
          </div>
        </div>
      )}

      <ConfirmActionDialog
        open={deleteTarget !== null}
        title={"删除联系人「" + (deleteTarget?.name ?? "") + "」？"}
        description="删除后联系人停用（历史单据仍保留该联系人快照）。"
        confirmLabel="确认删除"
        tone="danger"
        busy={deleteBusy}
        onConfirm={runDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmActionDialog
        open={primaryTarget !== null}
        title={"将「" + (primaryTarget?.name ?? "") + "」设为主联系人？"}
        description="原主联系人将自动取消（后端事务权威处理）。"
        confirmLabel="确认设置"
        tone="primary"
        busy={false}
        onConfirm={runSetPrimary}
        onCancel={() => setPrimaryTarget(null)}
      />
    </div>
  );
}