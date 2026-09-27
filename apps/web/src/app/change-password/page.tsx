"use client";

/**
 * /change-password — 强制 / 自助改密页（ADR-0059）
 *
 * - **强制改密路径**：新建用户初始密码 123456 或管理员重置后，登录/任何业务请求都被引导到本页
 *   （服务端 requirePermission 对 mustChangePassword 会话一律 403 PASSWORD_CHANGE_REQUIRED）。
 * - **自助改密路径**：个人中心「修改密码」入口同源复用同一接口（POST /api/auth/change-password）。
 * - 本页不挂在 dashboard shell 下（避免渲染业务导航与服务端 Gate 冲突），只依赖 /api/auth/me。
 * - 密码策略来自 @nilier-crm/shared（与后端同一 SSOT，禁止前端另写一套规则）。
 */
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PASSWORD_POLICY_DESCRIPTION, passwordPolicyErrors } from "@nilier-crm/shared";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { INPUT_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SECONDARY_CLASS } from "@/lib/ui-classes";
import { FormField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";

interface SessionUserLite {
  id: string;
  email: string;
  name: string | null;
  mustChangePassword?: boolean;
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionUserLite | null>(null);
  const [checking, setChecking] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<SessionUserLite>("/api/auth/me", { signal: controller.signal })
      .then((body) => {
        setSession(body.data);
        setChecking(false);
      })
      .catch(() => {
        // 未登录 / 会话过期：回到登录页
        router.replace("/login");
      });
    return () => controller.abort();
  }, [router]);

  // 策略未满足项的实时提示（与服务端同一函数）
  const policyErrors = newPassword ? passwordPolicyErrors(newPassword) : [];
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setDone(true);
      setSubmitting(false);
      // 会话状态由 dashboard layout 的 SessionProvider 重新拉取（/api/auth/me）
      setTimeout(() => {
        router.replace("/dashboard");
        router.refresh();
      }, 1200);
    } catch (err: unknown) {
      const message = err instanceof ApiClientError ? err.message : "网络异常，请稍后重试";
      setError(message);
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <p className="text-sm text-ink-muted">正在校验会话…</p>
      </div>
    );
  }

  const forced = session?.mustChangePassword === true;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-canvas to-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 shadow-elevation-lg">
        <div className="mb-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-elevation-md">
            <Icon name="lock" size={20} />
          </span>
          <h1 className="mt-4 text-xl font-semibold text-ink-primary">
            {forced ? "首次登录：请设置新密码" : "修改密码"}
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {forced
              ? "当前账号仍在使用初始密码，修改完成后才能使用系统功能。"
              : "为了账号安全，请定期更换密码。"}
          </p>
          <p className="mt-2 text-xs text-ink-muted">
            账号：{session?.email}
          </p>
        </div>

        {done ? (
          <div
            role="status"
            className="rounded-md border border-status-success-border bg-status-success-bg px-3 py-2 text-sm text-status-success-text"
          >
            密码已更新，正在进入系统…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField label="当前密码" required hint={forced ? "初始密码为 123456" : undefined}>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className={INPUT_CLASS}
                placeholder="请输入当前密码"
              />
            </FormField>

            <FormField
              label="新密码"
              required
              hint={PASSWORD_POLICY_DESCRIPTION}
              error={policyErrors.length > 0 ? policyErrors.join("；") : undefined}
            >
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className={INPUT_CLASS}
                placeholder="大写 + 小写 + 数字，至少 8 位"
              />
            </FormField>

            <FormField label="确认新密码" required error={mismatch ? "两次输入的新密码不一致" : undefined}>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className={INPUT_CLASS}
                placeholder="请再次输入新密码"
              />
            </FormField>

            {error && (
              <div role="alert" className="rounded-md border border-status-danger-border bg-status-danger-bg px-3 py-2 text-sm text-status-danger-text">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => router.push("/profile")}
                disabled={forced}
                className={BUTTON_SECONDARY_CLASS + " disabled:cursor-not-allowed disabled:opacity-50"}
                title={forced ? "请先完成初始密码修改" : undefined}
              >
                个人中心
              </button>
              <button type="submit" disabled={submitting} className={BUTTON_PRIMARY_CLASS}>
                {submitting ? "提交中…" : "确认修改"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
