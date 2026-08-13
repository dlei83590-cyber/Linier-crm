"use client";

import Link from "next/link";
import { hasPermission, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
import { MODULES } from "@/lib/frontend/modules";

/**
 * System Overview（P0.5 Release Metadata Cleanup + F2-0 IA v2）
 *
 * - 版本 / Git SHA / Build ID / 部署环境全部来自 build-time 注入的 NEXT_PUBLIC_*
 *   （SSOT = root package.json version，注入逻辑见 apps/web/next.config.ts）
 * - 模块快捷入口消费唯一 Module Registry（apps/web/src/lib/frontend/modules.ts），
 *   仅展示 availability=ready 且有权限的模块；不再维护第二份菜单事实。
 */

function shortSha(sha: string | undefined): string {
  return sha && sha.length > 7 ? sha.slice(0, 7) : sha ?? "-";
}

const BUILD_CARDS = [
  { label: "发布版本", value: process.env.NEXT_PUBLIC_RELEASE_VERSION ?? "-" },
  { label: "Git Commit", value: shortSha(process.env.NEXT_PUBLIC_GIT_SHA) },
  { label: "Build ID", value: process.env.NEXT_PUBLIC_BUILD_ID ?? "-" },
  { label: "部署环境", value: process.env.NEXT_PUBLIC_DEPLOYMENT_ENV ?? "-" },
];

export default function DashboardPage() {
  const { state } = useSession();
  const user = state.user;
  const roles = (user?.roles ?? []) as RoleCode[];

  const greeting =
    user?.roles?.includes("SUPER_ADMIN") ? "管理员" : user?.name ?? user?.email ?? "用户";

  const readyModules = MODULES.filter(
    (m) =>
      m.availability === "ready" &&
      (m.permission === null || hasPermission(roles, m.permission)),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          欢迎回来，{greeting}。这里是系统概览。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {BUILD_CARDS.map((card) => (
          <div key={card.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-400">{card.label}</p>
            <p className="mt-1 text-lg font-medium text-slate-800">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700">模块导航</h2>
        {readyModules.length > 0 ? (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {readyModules.map((m) => (
              <Link
                key={m.id}
                href={m.route}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
              >
                {m.label}
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            暂无已开放的模块。
          </p>
        )}
      </div>
    </div>
  );
}
