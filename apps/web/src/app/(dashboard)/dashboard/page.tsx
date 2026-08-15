"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { hasPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import {
  modulesByDomainGrouped,
  uiCapabilities,
  type FrontendModule,
} from "@/lib/frontend/modules";

/**
 * Dashboard v2 — F2-5B 四区模型（CTO #12698/#12725 锁定）
 *
 * 今日工作 / 快捷操作 / 业务入口 / 系统状态
 *
 * 规则：
 * - 唯一数据源 = Module Registry（modulesByDomainGrouped 三态投影），
 *   不恢复旧「模块按钮墙」，不维护第二份菜单事实。
 * - 快捷操作 = Registry ui.create 投影（ui 层是唯一允许 UI 消费的层）；
 *   无 create 能力或无权限的模块不出现（当前 ready 模块 ui.create 全 false → 空态，
 *   不虚构指标，等模块真正开放 create 后自动点亮）。
 * - 业务入口 = ready 域分组 + 权限过滤，按域展示 ready 模块链接。
 * - 系统状态 = 发布版本 + 运行状态（复用已有 /api/health/ready，不新增 backend API）；
 *   Git Commit / Build ID / Deployment 不再作为首页核心卡片（保留在 AdminShell footer）。
 */
export default function DashboardPage() {
  const { state } = useSession();
  const user = state.user;
  const roles = (user?.roles ?? []) as RoleCode[];
  const [health, setHealth] = useState<"checking" | "ok" | "down">("checking");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health/ready")
      .then((r) => {
        if (!cancelled) setHealth(r.ok ? "ok" : "down");
      })
      .catch(() => {
        if (!cancelled) setHealth("down");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const greeting =
    user?.roles?.includes("SUPER_ADMIN") ? "管理员" : user?.name ?? user?.email ?? "用户";
  const today = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  // 业务入口：ready 模块按域分组（权限过滤），仅保留有 ready 项的域
  const entryGroups = modulesByDomainGrouped()
    .map((g) => ({
      domain: g.domain,
      ready: g.ready.filter(
        (m) => m.permission === null || hasPermission(roles, m.permission),
      ),
    }))
    .filter((g) => g.ready.length > 0);

  // 快捷操作：仅 Registry ui.create 已开放且有权限的 ready 模块（当前为空态）
  const quickActions: FrontendModule[] = modulesByDomainGrouped()
    .flatMap((g) => g.ready)
    .filter(
      (m) =>
        uiCapabilities(m.id).create &&
        (m.permission === null || hasPermission(roles, m.permission)),
    );

  return (
    <div className="space-y-6">
      {/* ① 今日工作 */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h1 className="text-xl font-semibold text-slate-800">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          欢迎回来，{greeting}。今天是 {today}。
        </p>
      </section>

      {/* ② 快捷操作 */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium text-slate-700">快捷操作</h2>
        {quickActions.length > 0 ? (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {quickActions.map((m) => (
              <Link
                key={m.id}
                href={`${m.route}/new`}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
              >
                新建{m.label}
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            暂无已开放的快捷操作。模块开放创建能力后会自动出现在这里。
          </p>
        )}
      </section>

      {/* ③ 业务入口 */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium text-slate-700">业务入口</h2>
        {entryGroups.length > 0 ? (
          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {entryGroups.map(({ domain, ready }) => (
              <div key={domain.id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-4">
                <h3 className="text-sm font-semibold text-slate-600">{domain.label}</h3>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {ready.map((m) => (
                    <Link
                      key={m.id}
                      href={m.route}
                      className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                    >
                      {m.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">暂无已开放的模块。</p>
        )}
      </section>

      {/* ④ 系统状态 */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium text-slate-700">系统状态</h2>
        <div className="mt-3 flex flex-wrap items-center gap-6">
          <div>
            <p className="text-xs text-slate-400">发布版本</p>
            <p className="mt-1 text-lg font-medium text-slate-800">
              {process.env.NEXT_PUBLIC_RELEASE_VERSION ?? "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400">运行状态</p>
            <p className="mt-1 flex items-center gap-2 text-lg font-medium text-slate-800">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  health === "ok"
                    ? "bg-emerald-500"
                    : health === "down"
                      ? "bg-red-500"
                      : "bg-amber-400"
                }`}
              />
              {health === "ok" ? "正常" : health === "down" ? "异常" : "检测中…"}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
