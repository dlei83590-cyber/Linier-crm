"use client";

/**
 * Customer 360「跟进活动」Tab（FE 2.0 现代时间线）
 *
 * 数据：GET/POST /api/business-partners/:id/activities（CustomerActivity，Migration 0050/0051）
 * 现代时间线：图标节点（FOLLOW_UP/VISIT_PLAN/CHECK_IN/COMMENT/APPROVAL 轻量 icon + 语义 accent）
 * + 操作人（服务端只读投影 createdBy/submittedBy/approvedBy/rejectedBy）+ 时间 + 类型 + 内容 + 状态徽标。
 * 三态：loading 骨架 / error 图标+重试 / empty 图标+说明+CTA（禁止把错误伪装成空态）。
 * 驳回原因：window.prompt → RejectDialog（FormDialog 风格，必填校验 + busy 防重复提交）。
 * 成功反馈：轻量 Toast；服务端真实错误（含签到超范围距离）toast.error 呈现。
 *
 * 业务逻辑与既有 API 完全一致（submit/approve/reject/comment/checkin 契约不变）。
 */
import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ReferenceSelector, StatusBadge } from "@/components/workspace";
import { INPUT_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";
import {
  activityTypeMeta,
  activityStatusMeta,
  activityFollowUpLevelMeta,
  type ActivityTypeKey,
} from "@/lib/customer/activity-meta";
import type { StatusTone } from "@/components/design-system";
import { loadUserOptions, type UserOption } from "@/lib/frontend/user-options";
import { ActivityTypeIcon, IconAlertCircle, IconRefreshCw } from "./icons";
import { GEOLOCATION_OPTIONS, geolocationErrorMessage } from "@/lib/visit/geolocation";

interface ActivityRow {
  id: string;
  activityType: "FOLLOW_UP" | "VISIT_PLAN" | "CHECK_IN";
  contact: { id: string; name: string | null; title: string | null } | null;
  summary: string | null;
  nextAction: string | null;
  reminderAt: string | null;
  // followup-level（Migration 0055）：跟进程度 + 责任人只读投影
  followUpLevel: "BASIC" | "IMPORTANT" | "DECISION" | null;
  responsibleUserId: string | null;
  responsibleUser: { id: string; name: string | null; email: string | null } | null;
  planDate: string | null;
  checkinAt: string | null;
  latitude: string | null;
  longitude: string | null;
  locationNote: string | null;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | null;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  commentCount: number;
  occurredAt: string;
  createdBy: { id: string; name: string | null; email: string | null } | null;
  submittedBy: { id: string; name: string | null; email: string | null } | null;
  approvedBy: { id: string; name: string | null; email: string | null } | null;
  rejectedBy: { id: string; name: string | null; email: string | null } | null;
}

interface ActivityCommentRow {
  id: string;
  content: string;
  createdById: string | null;
  createdAt: string;
  createdBy: { id: string; name: string | null; email: string | null } | null;
}

type ActivityMode = "FOLLOW_UP" | "VISIT_PLAN" | "CHECK_IN";

const TYPE_LABELS: Record<string, string> = { FOLLOW_UP: "跟进", VISIT_PLAN: "拜访计划", CHECK_IN: "签到" };

const TONE_NODE: Record<StatusTone, { soft: string; text: string }> = {
  neutral: { soft: "bg-canvas", text: "text-ink-secondary" },
  info: { soft: "bg-status-info-bg", text: "text-status-info-text" },
  success: { soft: "bg-status-success-bg", text: "text-status-success-text" },
  warning: { soft: "bg-status-warning-bg", text: "text-status-warning-text" },
  danger: { soft: "bg-status-danger-bg", text: "text-status-danger-text" },
};

function userName(u: { name: string | null; email: string | null } | null | undefined): string {
  if (!u) return "—";
  return u.name ?? u.email ?? "—";
}

/** 驳回原因 FormDialog（替代 window.prompt；必填校验 + busy 防重复） */
function RejectDialog({
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setErr(null);
    }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const t = reason.trim();
    if (!t) {
      setErr("驳回原因必填");
      return;
    }
    onConfirm(t);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="驳回跟进"
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="animate-dialog-in w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-elevation-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-ink-primary">驳回跟进</h2>
        <p className="mt-1.5 text-sm text-ink-secondary">请输入驳回原因（必填），提交后记录审计。</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className={INPUT_CLASS + " mt-3"}
          placeholder="驳回原因"
          autoFocus
        />
        {err ? <p className="mt-1 text-xs text-status-danger-text">{err}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className={BUTTON_SECONDARY_CLASS}>
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded-md bg-status-danger-text px-3 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "提交中…" : "确认驳回"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ActivityTimeline({
  partnerId,
  initialMode = "FOLLOW_UP",
}: {
  partnerId: string;
  initialMode?: ActivityMode;
}) {
  const toast = useToast();
  const [items, setItems] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // 进行中操作的活动 id（null=空闲）
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);

  // 表单
  const [mode, setMode] = useState<ActivityMode>(initialMode);
  const [summary, setSummary] = useState("");
  const [nextAction, setNextAction] = useState("");
  // followup-level（Migration 0055）：跟进程度 + 下次跟进时间 + 责任人
  const [followUpLevel, setFollowUpLevel] = useState<"BASIC" | "IMPORTANT" | "DECISION">("BASIC");
  const [reminderAt, setReminderAt] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersUnavailable, setUsersUnavailable] = useState(false);
  const [planDate, setPlanDate] = useState("");
  const [geo, setGeo] = useState<{ lat: string; lng: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // 负责人选择器数据源（/api/users?isActive=true，User SSOT）；无 user:view 权限 → 加载失败（服务端投影兜底）
  useEffect(() => {
    const controller = new AbortController();
    loadUserOptions(controller.signal)
      .then((opts) => {
        if (opts === null) {
          setUsersUnavailable(true);
        } else {
          setUserOptions(opts);
        }
      })
      .catch(() => setUsersUnavailable(true))
      .finally(() => setUsersLoading(false));
    return () => controller.abort();
  }, []);

  // 评论
  const [comments, setComments] = useState<Record<string, ActivityCommentRow[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [commentText, setCommentText] = useState<Record<string, string>>({});

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<ActivityRow[]>("/api/business-partners/" + partnerId + "/activities?page=1&pageSize=50")
      .then(({ data }) => setItems(data))
      .catch((err: unknown) => setError(err instanceof ApiClientError ? err.message : "加载活动失败"))
      .finally(() => setLoading(false));
  }, [partnerId]);

  useEffect(() => {
    load();
  }, [load]);

  const fetchComments = useCallback(
    async (activityId: string) => {
      try {
        const { data } = await apiFetch<ActivityCommentRow[]>(
          "/api/business-partners/" + partnerId + "/activities/" + activityId + "/comments",
        );
        setComments((prev) => ({ ...prev, [activityId]: data }));
      } catch {
        // 评论加载失败不阻断时间线
      }
    },
    [partnerId],
  );

  const toggleComments = (activityId: string) => {
    const next = !expanded[activityId];
    setExpanded((prev) => ({ ...prev, [activityId]: next }));
    if (next && !comments[activityId]) fetchComments(activityId);
  };

  const runAction = async (
    activityId: string,
    action: "submit" | "approve" | "reject",
    rejectReason?: string,
  ) => {
    setBusy(activityId);
    try {
      await apiFetch("/api/business-partners/" + partnerId + "/activities/" + activityId + "/" + action, {
        method: "POST",
        body: rejectReason ? JSON.stringify({ rejectReason }) : undefined,
      });
      await load();
      if (action === "submit") toast.success("已提交审批");
      if (action === "approve") toast.success("已批准");
      if (action === "reject") {
        toast.success("已驳回");
        setRejectTarget(null);
      }
    } catch (err: unknown) {
      const message = err instanceof ApiClientError ? err.message : "操作失败";
      toast.error(action === "reject" ? "驳回失败" : action === "approve" ? "批准失败" : "提交失败", message);
    } finally {
      setBusy(null);
    }
  };

  const addComment = async (activityId: string) => {
    const content = (commentText[activityId] ?? "").trim();
    if (!content) return;
    setBusy(activityId);
    try {
      await apiFetch("/api/business-partners/" + partnerId + "/activities/" + activityId + "/comments", {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setCommentText((prev) => ({ ...prev, [activityId]: "" }));
      await Promise.all([load(), fetchComments(activityId)]);
      toast.success("评论已发送");
    } catch (err: unknown) {
      toast.error("评论失败", err instanceof ApiClientError ? err.message : "网络错误");
    } finally {
      setBusy(null);
    }
  };

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setFormError("浏览器不支持定位");
      return;
    }
    setFormError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ lat: String(pos.coords.latitude), lng: String(pos.coords.longitude) }),
      (err) => {
        // 定位拒绝/信号不可用/超时 → 明确真实原因（FRT-04，禁止静默失败）
        setGeo(null);
        setFormError(geolocationErrorMessage(err?.code));
      },
      GEOLOCATION_OPTIONS,
    );
  };

  const submit = async () => {
    setBusy("__form__");
    setFormError(null);
    try {
      const body: Record<string, unknown> = { activityType: mode };
      if (mode === "FOLLOW_UP") {
        if (!summary.trim()) {
          setFormError("跟进内容必填");
          return;
        }
        // followup-level 动态必填（与服务端 zod 一致）：BASIC=跟进内容；IMPORTANT=+下一步行动+下次跟进时间；DECISION=上述+负责人
        if (followUpLevel !== "BASIC" && !nextAction.trim()) {
          setFormError("重点跟进/决策推进必须填写下一步行动");
          return;
        }
        if (followUpLevel !== "BASIC" && !reminderAt) {
          setFormError("重点跟进/决策推进必须填写下次跟进时间");
          return;
        }
        if (followUpLevel === "DECISION" && !usersUnavailable && !responsibleUserId) {
          setFormError("决策推进必须选择负责人");
          return;
        }
        body.followUpLevel = followUpLevel;
        body.summary = summary.trim();
        body.nextAction = nextAction.trim() || undefined;
        if (reminderAt) body.reminderAt = new Date(reminderAt).toISOString();
        // 负责人：有选择 → 传真实 User.id；无 user:view（userOptions=null）→ 不传，服务端按客户/商机负责人投影
        if (responsibleUserId) body.responsibleUserId = responsibleUserId;
      } else if (mode === "VISIT_PLAN") {
        if (!planDate) {
          setFormError("请选择拜访计划日期（必填）");
          return;
        }
        body.planDate = new Date(planDate).toISOString();
        body.summary = summary.trim() || undefined;
      } else {
        if (!geo) {
          setFormError("请先获取定位");
          return;
        }
        body.latitude = Number(geo.lat);
        body.longitude = Number(geo.lng);
        body.locationNote = summary.trim() || undefined;
      }
      const { data } = await apiFetch<{ distanceMeters?: number | null }>(
        "/api/business-partners/" + partnerId + "/activities",
        { method: "POST", body: JSON.stringify(body) },
      );
      if (mode === "CHECK_IN") {
        // 范围内成功反馈：服务端 Haversine 距离事实（客户未配置范围时 distanceMeters=null）
        toast.success(data?.distanceMeters != null ? "签到成功（距客户 " + data.distanceMeters + " 米）" : "签到成功");
      } else {
        toast.success(mode === "FOLLOW_UP" ? "跟进已保存" : "拜访计划已保存");
      }
      setSummary("");
      setNextAction("");
      setFollowUpLevel("BASIC");
      setReminderAt("");
      setResponsibleUserId("");
      setPlanDate("");
      setGeo(null);
      load();
    } catch (err: unknown) {
      const message = err instanceof ApiClientError ? err.message : "保存失败";
      toast.error("保存失败", message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-elevation-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-primary">跟进活动</h2>
        {items.length > 0 && <span className="text-xs text-ink-muted">共 {items.length} 条</span>}
      </div>

      <PermissionGuard permission={actionPermission("project-visit", "create")}>
        <div className="mb-5 space-y-2.5 rounded-lg border border-border bg-canvas/50 p-3.5">
          <div className="flex flex-wrap gap-1.5">
            {(["FOLLOW_UP", "VISIT_PLAN", "CHECK_IN"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 " +
                  (mode === m
                    ? "bg-brand-600 text-white"
                    : "border border-border bg-surface text-ink-secondary hover:bg-surface-hover")
                }
              >
                {TYPE_LABELS[m]}
              </button>
            ))}
          </div>
          {mode === "FOLLOW_UP" && (
            <>
              {/* followup-level（Migration 0055）：跟进程度 → 动态必填维度 */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-ink-muted">跟进程度：</span>
                {(
                  [
                    ["BASIC", "普通跟进"],
                    ["IMPORTANT", "重点跟进"],
                    ["DECISION", "决策推进"],
                  ] as const
                ).map(([lv, label]) => (
                  <button
                    key={lv}
                    type="button"
                    onClick={() => setFollowUpLevel(lv)}
                    className={
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 " +
                      (followUpLevel === lv
                        ? "bg-brand-600 text-white"
                        : "border border-border bg-surface text-ink-secondary hover:bg-surface-hover")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} className={INPUT_CLASS} rows={2} placeholder="跟进内容（必填）" />
              <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} className={INPUT_CLASS} placeholder={"下次行动" + (followUpLevel === "BASIC" ? "（可选）" : "（必填）")} />
              {followUpLevel !== "BASIC" && (
                <input
                  type="datetime-local"
                  value={reminderAt}
                  onChange={(e) => setReminderAt(e.target.value)}
                  className={INPUT_CLASS}
                />
              )}
              {followUpLevel === "DECISION" && (
                <div className="flex flex-col gap-1">
                  <ReferenceSelector
                    id="followup-responsible-user"
                    label="负责人"
                    value={responsibleUserId}
                    onChange={setResponsibleUserId}
                    options={userOptions.map((u) => ({ value: u.id, label: u.name ?? u.email }))}
                    loading={usersLoading}
                    placeholder="选择负责人"
                    required
                  />
                  {usersUnavailable && (
                    <p className="text-xs text-ink-muted">
                      无用户列表权限（user:view）时由系统默认负责人兜底：客户负责人 → 商机负责人。
                    </p>
                  )}
                </div>
              )}
            </>
          )}
          {mode === "VISIT_PLAN" && (
            <>
              <input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} className={INPUT_CLASS} />
              <input value={summary} onChange={(e) => setSummary(e.target.value)} className={INPUT_CLASS} placeholder="拜访目的（可选）" />
            </>
          )}
          {mode === "CHECK_IN" && (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={locate} className={BUTTON_SECONDARY_CLASS + " text-xs"}>
                {geo ? "已获取定位：" + geo.lat + ", " + geo.lng : "获取定位"}
              </button>
              <input value={summary} onChange={(e) => setSummary(e.target.value)} className={INPUT_CLASS + " max-w-xs"} placeholder="位置备注（可选）" />
            </div>
          )}
          {formError && <p className="text-xs text-status-danger-text">{formError}</p>}
          <div className="flex items-center justify-end">
            <button onClick={submit} disabled={busy !== null} className={BUTTON_PRIMARY_CLASS + " text-xs"}>
              保存
            </button>
          </div>
        </div>
      </PermissionGuard>

      {loading ? (
        <div className="space-y-3" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-16 flex-1" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-status-danger-border bg-status-danger-bg/30 py-8 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-status-danger-bg text-status-danger-text">
            <IconAlertCircle className="h-5 w-5" />
          </span>
          <p className="text-sm text-status-danger-text">{error}</p>
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-hover">
            <IconRefreshCw className="h-3.5 w-3.5" />
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="暂无跟进记录"
          description={mode === "FOLLOW_UP" ? "记录跟进内容，或创建拜访计划/定位签到。" : "上方可新建跟进、拜访计划或签到。"}
        />
      ) : (
        <ol className="relative space-y-3">
          {items.map((a, idx) => {
            const typeMeta = activityTypeMeta(a.activityType as ActivityTypeKey);
            const node = TONE_NODE[typeMeta.tone];
            const statusMeta = activityStatusMeta(a.status);
            // followup-level（Migration 0055）：跟进程度徽标（null=未分级不渲染）
            const levelMeta = a.activityType === "FOLLOW_UP" ? activityFollowUpLevelMeta(a.followUpLevel) : null;
            const levelTone = levelMeta ? TONE_NODE[levelMeta.tone] : null;
            const isLast = idx === items.length - 1;
            return (
              <li key={a.id} className="flex gap-3">
                {/* 图标节点 + 连接线 */}
                <div className="flex shrink-0 flex-col items-center">
                  <span className={"flex h-8 w-8 items-center justify-center rounded-full " + node.soft}>
                    <ActivityTypeIcon type={a.activityType} className={"h-4 w-4 " + node.text} />
                  </span>
                  {!isLast && <span className="mt-1 w-px flex-1 bg-border" aria-hidden="true" />}
                </div>

                {/* 内容卡 */}
                <div className="mb-1 min-w-0 flex-1 rounded-lg border border-border bg-surface p-3.5 shadow-elevation-sm">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className={"text-xs font-semibold " + node.text}>{typeMeta.label}</span>
                    {statusMeta && (
                      <StatusBadge status={a.status ?? ""} label={statusMeta.label} tone={statusMeta.tone} />
                    )}
                    {levelMeta && levelTone && (
                      <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + levelTone.soft + " " + levelTone.text}>
                        {levelMeta.label}
                      </span>
                    )}
                    <span className="text-xs text-ink-muted">{formatDate(a.occurredAt)}</span>
                    <span className="text-xs text-ink-muted">操作人 {userName(a.createdBy)}</span>
                    {a.activityType === "FOLLOW_UP" && a.responsibleUser && (
                      <span className="text-xs text-ink-muted">负责人 {userName(a.responsibleUser)}</span>
                    )}
                    {a.contact?.name && <span className="text-xs text-ink-muted">联系人：{a.contact.name}</span>}
                  </div>

                  {a.summary && <p className="mt-1.5 text-sm text-ink-primary">{a.summary}</p>}
                  {a.nextAction && <p className="mt-1 text-xs text-ink-secondary">下次行动：{a.nextAction}</p>}
                  {a.activityType === "FOLLOW_UP" && a.reminderAt && (
                    <p className="mt-1 text-xs text-ink-secondary">下次跟进：{formatDate(a.reminderAt)}</p>
                  )}
                  {a.activityType === "CHECK_IN" && (
                    <p className="mt-1 text-xs text-ink-secondary">
                      位置：{a.latitude ?? "—"}, {a.longitude ?? "—"} {a.locationNote ? "（" + a.locationNote + "）" : ""}
                    </p>
                  )}

                  {/* 审批子事件（FOLLOW_UP 参与审批；APPROVAL 轻量 icon + accent） */}
                  {a.activityType === "FOLLOW_UP" && (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-secondary">
                      {a.submittedAt && (
                        <span className="inline-flex items-center gap-1">
                          <IconShieldText className="h-3.5 w-3.5 text-status-warning-text" />
                          提交 {userName(a.submittedBy)} · {formatDate(a.submittedAt)}
                        </span>
                      )}
                      {a.approvedAt && (
                        <span className="inline-flex items-center gap-1">
                          <IconShieldText className="h-3.5 w-3.5 text-status-success-text" />
                          批准 {userName(a.approvedBy)} · {formatDate(a.approvedAt)}
                        </span>
                      )}
                      {a.rejectedAt && (
                        <span className="inline-flex items-center gap-1 text-status-danger-text">
                          <IconShieldText className="h-3.5 w-3.5" />
                          驳回 {userName(a.rejectedBy)} · {formatDate(a.rejectedAt)}
                        </span>
                      )}
                    </div>
                  )}
                  {a.status === "REJECTED" && a.rejectReason && (
                    <p className="mt-1 text-xs text-status-danger-text">驳回原因：{a.rejectReason}</p>
                  )}

                  {/* 跟进审批动作（仅 FOLLOW_UP） */}
                  {a.activityType === "FOLLOW_UP" &&
                    (a.status === "DRAFT" || a.status === "REJECTED") && (
                      <PermissionGuard permission={actionPermission("project-visit", "edit")}>
                        <div className="mt-2 flex gap-1.5">
                          <button
                            onClick={() => runAction(a.id, "submit")}
                            disabled={busy !== null}
                            className={BUTTON_SECONDARY_CLASS + " text-xs"}
                          >
                            提交审批
                          </button>
                        </div>
                      </PermissionGuard>
                    )}
                  {a.activityType === "FOLLOW_UP" && a.status === "SUBMITTED" && (
                    <PermissionGuard permission={actionPermission("project-visit", "approve")}>
                      <div className="mt-2 flex gap-1.5">
                        <button
                          onClick={() => runAction(a.id, "approve")}
                          disabled={busy !== null}
                          className="rounded-md bg-status-success-text px-2.5 py-1 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          批准
                        </button>
                        <button
                          onClick={() => setRejectTarget(a.id)}
                          disabled={busy !== null}
                          className="rounded-md border border-status-danger-border px-2.5 py-1 text-xs font-medium text-status-danger-text transition-colors hover:bg-status-danger-bg disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          驳回
                        </button>
                      </div>
                    </PermissionGuard>
                  )}

                  {/* 评论（所有活动类型；最小 ActivityComment） */}
                  <div className="mt-2">
                    <button
                      onClick={() => toggleComments(a.id)}
                      className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
                    >
                      <IconComment className="h-3.5 w-3.5" />
                      评论（{a.commentCount}）
                    </button>
                  </div>
                  {expanded[a.id] && (
                    <div className="mt-2 space-y-2 rounded-md border border-border bg-canvas/40 p-2.5">
                      {comments[a.id] && comments[a.id].length > 0 ? (
                        comments[a.id].map((c) => (
                          <div key={c.id} className="text-xs text-ink-primary">
                            <span className="text-ink-muted">{formatDate(c.createdAt)} · {userName(c.createdBy)}：</span>
                            {c.content}
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-ink-muted">暂无评论。</p>
                      )}
                      <PermissionGuard permission={actionPermission("project-visit", "create")}>
                        <div className="flex gap-2">
                          <input
                            value={commentText[a.id] ?? ""}
                            onChange={(e) => setCommentText((prev) => ({ ...prev, [a.id]: e.target.value }))}
                            className={INPUT_CLASS + " flex-1"}
                            placeholder="添加评论…"
                          />
                          <button
                            onClick={() => addComment(a.id)}
                            disabled={busy !== null || !(commentText[a.id] ?? "").trim()}
                            className={BUTTON_PRIMARY_CLASS + " text-xs"}
                          >
                            发送
                          </button>
                        </div>
                      </PermissionGuard>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <RejectDialog
        open={rejectTarget !== null}
        busy={busy === rejectTarget}
        onCancel={() => setRejectTarget(null)}
        onConfirm={(reason) => {
          if (rejectTarget) runAction(rejectTarget, "reject", reason);
        }}
      />
    </section>
  );
}

/** 审批/评论小图标（Lucide 风格，避免在时间线内联 SVG 重复） */
function IconShieldText({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="M9 12h6M9 16h4" />
    </svg>
  );
}

function IconComment({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
