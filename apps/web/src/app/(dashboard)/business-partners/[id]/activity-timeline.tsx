"use client";

/**
 * Phase 3 MVP — Customer 360「跟进活动」Tab（跟进 / 拜访计划 / 定位签到时间线）
 *
 * 数据：GET/POST /api/business-partners/:id/activities（CustomerActivity，Migration 0050）
 * 签到：浏览器 navigator.geolocation 获取经纬度 → POST CHECK_IN（checkinAt 服务端 now 落库）
 * HOLD：审批/评论/群消息/酷卡片/签退/围栏/引擎
 */
import { useCallback, useEffect, useState } from "react";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { actionPermission } from "@nilier-crm/shared";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";

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
  occurredAt: string;
}

const TYPE_LABELS: Record<string, string> = { FOLLOW_UP: "跟进", VISIT_PLAN: "拜访计划", CHECK_IN: "签到" };

export function ActivityTimeline({ partnerId }: { partnerId: string }) {
  const [items, setItems] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 表单
  const [mode, setMode] = useState<"FOLLOW_UP" | "VISIT_PLAN" | "CHECK_IN">("FOLLOW_UP");
  const [summary, setSummary] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [planDate, setPlanDate] = useState("");
  const [geo, setGeo] = useState<{ lat: string; lng: string } | null>(null);

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

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setError("浏览器不支持定位");
      return;
    }
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ lat: String(pos.coords.latitude), lng: String(pos.coords.longitude) }),
      () => setError("定位失败，请检查浏览器定位权限"),
    );
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { activityType: mode };
      if (mode === "FOLLOW_UP") {
        body.summary = summary.trim();
        body.nextAction = nextAction.trim() || undefined;
      } else if (mode === "VISIT_PLAN") {
        body.planDate = planDate ? new Date(planDate).toISOString() : undefined;
        body.summary = summary.trim() || undefined;
      } else {
        if (!geo) {
          setError("请先获取定位");
          setBusy(false);
          return;
        }
        body.latitude = Number(geo.lat);
        body.longitude = Number(geo.lng);
        body.locationNote = summary.trim() || undefined;
      }
      await apiFetch("/api/business-partners/" + partnerId + "/activities", { method: "POST", body: JSON.stringify(body) });
      setSummary("");
      setNextAction("");
      setPlanDate("");
      setGeo(null);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-primary">跟进活动</h2>
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
          <button onClick={submit} disabled={busy} className={BUTTON_PRIMARY_CLASS + " text-xs"}>
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
          {items.map((a) => (
            <li key={a.id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded bg-brand-50 px-1.5 py-0.5 text-brand-700">{TYPE_LABELS[a.activityType]}</span>
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
