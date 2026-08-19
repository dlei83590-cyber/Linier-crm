"use client";

import { useSession } from "@/lib/session-context";

export default function ProfilePage() {
  const { state } = useSession();
  const user = state.user;

  if (!user) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">个人信息</h1>
        <p className="mt-1 text-sm text-ink-secondary">查看当前登录账号的基本信息与角色。</p>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-ink-muted">邮箱</dt>
            <dd className="mt-1 text-sm text-ink-primary">{user.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">姓名</dt>
            <dd className="mt-1 text-sm text-ink-primary">{user.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">角色</dt>
            <dd className="mt-1 text-sm text-ink-primary">{user.roles.join("、") || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">用户 ID</dt>
            <dd className="mt-1 break-all text-sm text-ink-primary">{user.id}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}