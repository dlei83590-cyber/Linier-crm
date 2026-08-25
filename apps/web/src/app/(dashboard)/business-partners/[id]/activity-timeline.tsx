"use client";

/**
 * Customer 360「跟进活动」Tab（跟进 / 拜访计划 / 定位签到时间线）
 *
 * 数据：GET/POST /api/business-partners/:id/activities（CustomerActivity，Migration 0050）
 * 跟进审批（Migration 0051，followup-collab MVP）：仅 FOLLOW_UP 参与
 *   DRAFT →（提交 project-visit:edit）→ SUBMITTED →（批准/驳回 project-visit:approve）→ APPROVED / REJECTED
 *   时间线显示状态徽标 + 评论数；评论 = ActivityComment 最小评论（GET/POST /activities/:activityId/comments）
 * 签到：浏览器 navigator.geolocation 获取经纬度 → POST CHECK_IN（checkinAt 服务端 now 落库）
 * HOLD：Workflow Designer/多级审批/会签/抄送/Notification Engine/群消息/酷卡片/签退/围栏/引擎
 */
import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";
import { GEOLOCATION_OPTIONS, geolocationErrorMessage } from "@/lib/visit/geolocation";

interface ActivityRow {
  id: string;
  activityType: "FOLLOW_UP" | "VISIT_PLAN" | "CHECK_IN";
  contact: { id: string; name: string | null; title: string | null } | null;
  summary: string | null;
  nextAction: string | null;
  reminderAt: string | null;
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
}

interface ActivityCommentRow {
  id: string;
  content: string;
  createdById: string | null;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = { FOLLOW_UP: "跟进", VISIT_PLAN: "拜访计划", CHECK_IN: "签到" };

const STATUS_META: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "待提交", cls: "bg-slate-100 text-slate-600" },
  SUBMITTED: { label: "待审批", cls: "bg-amber-50 text-amber-700" },
  APPROVED: { label: "已批准", cls: "bg-green-50 text-green-700" },
  REJECTED: { label: "已驳回", cls: "bg-red-50 text-red-700" },
};

export function ActivityTimeline({ partnerId }: { partnerId: string }) {
  const [items, setItems] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // 进行中操作的活动 id（null=空闲）
  const [notice, setNotice] = useState<string | null>(null); // 成功反馈（签到距离等；失败用 error）

  // 表单
  const [mode, setMode] = useState<"FOLLOW_UP" | "VISIT_PLAN" | "CHECK_IN">("FOLLOW_UP");
  const [summary, setSummary] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [planDate, setPlanDate] = useState("");
  const [geo, setGeo] = useState<{ lat: string; lng: string } | null>(null);

  // 评论
  const [comments, setComments] = useState<Record<string, ActivityCommentRow[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [commentText, setCommentText] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
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

  const runAction = async (activityId: string, action: "submit" | "approve" | "reject", rejectReason?: string) => {
    setBusy(activityId);
    setError(null);
    try {
      await apiFetch("/api/business-partners/" + partnerId + "/activities/" + activityId + "/" + action, {
        method: "POST",
        body: rejectReason ? JSON.stringify({ rejectReason }) : undefined,
      });
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  };

  const rejectWithReason = (activityId: string) => {
    const reason = window.prompt("请输入驳回原因（必填）");
    if (reason === null) return;
    if (!reason.trim()) {
      setError("驳回原因必填");
      return;
    }
    runAction(activityId, "reject", reason.trim());
  };

  const addComment = async (activityId: string) => {
    const content = (commentText[activityId] ?? "").trim();
    if (!content) return;
    setBusy(activityId);
    setError(null);
    try {
      await apiFetch("/api/business-partners/" + partnerId + "/activities/" + activityId + "/comments", {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setCommentText((prev) => ({ ...prev, [activityId]: "" }));
      await Promise.all([load(), fetchComments(activityId)]);
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "评论失败");
    } finally {
      setBusy(null);
    }
  };

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setError("浏览器不支持定位");
      return;
    }
    setError(null);
    setNotice(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ lat: String(pos.coords.latitude), lng: String(pos.coords.longitude) }),
      (err) => {
        // 定位拒绝/信号不可用/超时 → 明确真实原因（FRT-04，禁止静默失败）
        setGeo(null);
        setError(geolocationErrorMessage(err?.code));
      },
      GEOLOCATION_OPTIONS,
    );
  };

  const submit = async () => {
    setBusy("__form__");
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = { activityType: mode };
      if (mode === "FOLLOW_UP") {
        if (!summary.trim()) {
          setError("跟进内容必填");
          return;
        }
        body.summary = summary.trim();
        body.nextAction = nextAction.trim() || undefined;
      } else if (mode === "VISIT_PLAN") {
        if (!planDate) {
          setError("请选择拜访计划日期（必填）");
          return;
        }
        body.planDate = new Date(planDate).toISOString();
        body.summary = summary.trim() || undefined;
      } else {
        if (!geo) {
          setError("请先获取定位");
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
        setNotice(data?.distanceMeters != null ? "签到成功（距客户 " + data.distanceMeters + " 米）" : "签到成功");
      }
      setSummary("");
      setNextAction("");
      setPlanDate("");
      setGeo(null);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "保存失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-primary">跟进活动</h2>
      {notice && <p className="mb-2 rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-700">{notice}</p>}
      {error && <p className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      <PermissionGuard permission={actionPermission("project-visit", "create")}>
        <div className="mb-4 space-y-2 rounded-md border border-border p-3">
          <div className="flex gap-2">
            {(["FOLLOW_UP", "VISIT_PLAN", "CHECK_IN"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={"rounded-md px-3 py-1 text-xs " + (mode === m ? "bg-brand-600 text-white" : "border border-border")}
              >
                {TYPE_LABELS[m]}
              </button>
            ))}
          </div>
          {mode === "FOLLOW_UP" && (
            <>
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} className={INPUT_CLASS} rows={2} placeholder="跟进内容（必填）" />
              <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} className={INPUT_CLASS} placeholder="下次行动（可选）" />
            </>
          )}
          {mode === "VISIT_PLAN" && (
            <>
              <input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} className={INPUT_CLASS} />
              <input value={summary} onChange={(e) => setSummary(e.target.value)} className={INPUT_CLASS} placeholder="拜访目的（可选）" />
            </>
          )}
          {mode === "CHECK_IN" && (
            <div className="flex items-center gap-2">
              <button onClick={locate} className={BUTTON_SECONDARY_CLASS + " text-xs"}>
                {geo ? "已获取定位：" + geo.lat + ", " + geo.lng : "获取定位"}
              </button>
              <input value={summary} onChange={(e) => setSummary(e.target.value)} className={INPUT_CLASS} placeholder="位置备注（可选）" />
            </div>
          )}
          <button onClick={submit} disabled={busy !== null} className={BUTTON_PRIMARY_CLASS + " text-xs"}>
            保存
          </button>
        </div>
      </PermissionGuard>

      {loading ? (
        <p className="text-sm text-ink-muted">加载中…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-muted">暂无跟进记录。</p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => {
            const statusMeta = a.status ? STATUS_META[a.status] : null;
            return (
              <li key={a.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-brand-50 px-1.5 py-0.5 text-brand-700">{TYPE_LABELS[a.activityType]}</span>
                  {statusMeta && (
                    <span className={"rounded px-1.5 py-0.5 font-medium " + statusMeta.cls}>{statusMeta.label}</span>
                  )}
                  <span className="text-ink-muted">{formatDate(a.occurredAt)}</span>
                  {a.contact?.name && <span className="text-ink-muted">联系人：{a.contact.name}</span>}
                </div>
                {a.summary && <p className="mt-1 text-ink-primary">{a.summary}</p>}
                {a.nextAction && <p className="mt-0.5 text-xs text-ink-muted">下次行动：{a.nextAction}</p>}
                {a.activityType === "CHECK_IN" && (
                  <p className="mt-0.5 text-xs text-ink-muted">
                    位置：{a.latitude ?? "—"}, {a.longitude ?? "—"} {a.locationNote ? "（" + a.locationNote + "）" : ""}
                  </p>
                )}
                {a.status === "REJECTED" && a.rejectReason && (
                  <p className="mt-0.5 text-xs text-red-600">驳回原因：{a.rejectReason}</p>
                )}

                {/* 跟进审批动作（仅 FOLLOW_UP） */}
                {a.activityType === "FOLLOW_UP" &&
                  (a.status === "DRAFT" || a.status === "REJECTED") && (
                    <PermissionGuard permission={actionPermission("project-visit", "edit")}>
                      <div className="mt-1.5 flex gap-1.5">
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
                    <div className="mt-1.5 flex gap-1.5">
                      <button
                        onClick={() => runAction(a.id, "approve")}
                        disabled={busy !== null}
                        className="rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        批准
                      </button>
                      <button
                        onClick={() => rejectWithReason(a.id)}
                        disabled={busy !== null}
                        className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        驳回
                      </button>
                    </div>
                  </PermissionGuard>
                )}

                {/* 评论（所有活动类型；最小 ActivityComment） */}
                <div className="mt-1.5">
                  <button
                    onClick={() => toggleComments(a.id)}
                    className="text-xs text-brand-600 hover:underline"
                  >
                    评论（{a.commentCount}）
                  </button>
                </div>
                {expanded[a.id] && (
                  <div className="mt-1.5 space-y-1.5 rounded-md border border-border p-2">
                    {comments[a.id] && comments[a.id].length > 0 ? (
                      comments[a.id].map((c) => (
                        <p key={c.id} className="text-xs text-ink-primary">
                          <span className="text-ink-muted">{formatDate(c.createdAt)}：</span>
                          {c.content}
                        </p>
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
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
