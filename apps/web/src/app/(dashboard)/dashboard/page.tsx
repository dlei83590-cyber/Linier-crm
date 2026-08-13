"use client";

import { useSession } from "@/lib/session-context";

/**
 * System Overview（P0.5 Release Metadata Cleanup）
 *
 * - 版本 / Git SHA / Build ID / 部署环境全部来自 build-time 注入的 NEXT_PUBLIC_*
 *   （SSOT = root package.json version，注入逻辑见 apps/web/next.config.ts）
 * - 删除历史硬编码："Sprint 1" 阶段卡、静态"认证服务：正常"/"基础设施：就绪"
 *   （无实时 health contract，不得声称实时状态；产品 UI 不承担 ROADMAP SSOT）
 */

function shortSha(sha: string | undefined): string {
  return sha && sha.length > 7 ? sha.slice(0, 7) : sha ?? "-";
}

const BUILD_CARDS = [
  { label: "系统版本", value: process.env.NEXT_PUBLIC_APP_VERSION ?? "-" },
  { label: "Git Commit", value: shortSha(process.env.NEXT_PUBLIC_GIT_SHA) },
  { label: "Build ID", value: process.env.NEXT_PUBLIC_BUILD_ID ?? "-" },
  { label: "部署环境", value: process.env.NEXT_PUBLIC_DEPLOYMENT_ENV ?? "-" },
];

export default function DashboardPage() {
  const { state } = useSession();
  const user = state.user;

  const greeting =
    user?.roles?.includes("SUPER_ADMIN") ? "管理员" : user?.name ?? user?.email ?? "用户";

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
        <p className="mt-2 text-sm text-slate-500">
          菜单按权限框架自动显示：已开放的模块会出现在导航中，未授权模块不展示。
        </p>
      </div>
    </div>
  );
}
