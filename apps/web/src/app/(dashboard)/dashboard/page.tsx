"use client";

import { useSession } from "@/lib/session-context";

const STAT_CARDS = [
  { label: "系统版本", value: "v0.1.0-alpha" },
  { label: "当前阶段", value: "Sprint 1" },
  { label: "基础设施", value: "就绪" },
  { label: "认证服务", value: "正常" },
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
        {STAT_CARDS.map((card) => (
          <div key={card.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-400">{card.label}</p>
            <p className="mt-1 text-lg font-medium text-slate-800">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700">模块导航</h2>
        <p className="mt-2 text-sm text-slate-500">
          用户管理、部门管理、角色权限、操作日志等模块将在后续 Sprint 中逐步开放，菜单按权限框架自动显示。
        </p>
      </div>
    </div>
  );
}
