"use client";

/**
 * 个人中心（/profile）— 查看账号信息 + 自助修改密码（ADR-0059）
 *
 * 改密接口与首次登录强制改密同源（POST /api/auth/change-password）：需重新验证当前密码，
 * 新密码必须满足强密码策略（大小写字母 + 数字，长度 ≥ 8，SSOT = @nilier-crm/shared）。
 */
import { useState, type FormEvent } from "react";
import { useSession } from "@/lib/session-context";
import { PASSWORD_POLICY_DESCRIPTION, passwordPolicyErrors } from "@nilier-crm/shared";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { AppPage } from "@/components/workspace";
import { FormField } from "@/components/ui/form-field";
import { INPUT_CLASS, BUTTON_PRIMARY_CLASS } from "@/lib/ui-classes";
import { formatDate } from "@/lib/format";

export default function ProfilePage() {
  const { state, refresh } = useSession();
  const toast = useToast();
  const user = state.user;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    return null;
  }

  const policyErrors = newPassword ? passwordPolicyErrors(newPassword) : [];
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    if (!currentPassword) {
      setError("请输入当前密码");
      return;
    }
    if (policyErrors.length > 0) {
      setError(policyErrors[0]);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }

    setSubmitting(true);
    apiFetch("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    })
      .then(() => {
        toast.success("密码已更新", "下次登录请使用新密码");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        void refresh();
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiClientError ? err.message : "网络异常，请稍后重试");
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <AppPage>
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
              <dt className="text-xs text-ink-muted">密码状态</dt>
              <dd className="mt-1 text-sm text-ink-primary">
                {user.mustChangePassword
                  ? "仍为初始密码（需立即修改）"
                  : user.passwordChangedAt
                    ? `上次修改：${formatDate(user.passwordChangedAt)}`
                    : "已设置"}
              </dd>
            </div>
            {/* CC-10：不展示原始数据库 UUID（raw DB ID 红线）；用户身份以邮箱/姓名为准 */}
          </dl>
        </div>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink-primary">修改密码</h2>
          <p className="mt-1 text-xs text-ink-secondary">
            {PASSWORD_POLICY_DESCRIPTION}。忘记密码时请联系管理员「重置密码」，重置后需在登录时重新设置。
          </p>
          <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="当前密码" required>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className={INPUT_CLASS}
              />
            </FormField>
            <FormField
              label="新密码"
              required
              hint="大写 + 小写 + 数字，至少 8 位"
              error={policyErrors.length > 0 ? policyErrors.join("；") : undefined}
            >
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className={INPUT_CLASS}
              />
            </FormField>
            <FormField label="确认新密码" required error={mismatch ? "两次输入的新密码不一致" : undefined}>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className={INPUT_CLASS}
              />
            </FormField>
            {error ? (
              <p role="alert" className="sm:col-span-3 rounded-md border border-status-danger-border bg-status-danger-bg px-3 py-2 text-sm text-status-danger-text">
                {error}
              </p>
            ) : null}
            <div className="sm:col-span-3">
              <button type="submit" disabled={submitting} className={BUTTON_PRIMARY_CLASS}>
                {submitting ? "提交中…" : "修改密码"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </AppPage>
  );
}
