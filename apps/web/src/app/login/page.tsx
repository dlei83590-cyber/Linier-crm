"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { type SessionUser } from "@/lib/session-context";
import { setAuthToken } from "@/lib/auth-token";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "@/components/ui/icon";

interface LoginResponse {
  success: boolean;
  data?: {
    token: string;
    user: SessionUser;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

/** 品牌区能力亮点（仅大屏展示；图标来自 ui/icon.tsx，禁止 emoji） */
const BRAND_FEATURES: { icon: IconName; text: string }[] = [
  { icon: "building", text: "客户与项目全生命周期管理" },
  { icon: "package", text: "销售、采购与库存一站式管理" },
  { icon: "truck", text: "订单到交付的履约全程追踪" },
  { icon: "banknote", text: "财务核算与应收应付闭环" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json().catch(() => null)) as LoginResponse | null;

      if (!res.ok || !body?.success || !body.data?.token) {
        setError(body?.error?.message ?? "登录失败，请检查邮箱和密码");
        return;
      }

      setAuthToken(body.data.token);
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-brand-50 via-canvas to-canvas">
      {/* 品牌区：md 及以上显示（约 50% 宽），移动端隐藏 */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 md:flex md:w-1/2 md:items-center md:justify-center">
        {/* 装饰光晕（纯视觉，读屏忽略） */}
        <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />

        <div className="relative z-10 max-w-md px-12 py-16">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-lg font-bold text-white shadow-elevation-md">
              利
            </span>
            <span className="text-2xl font-semibold tracking-tight text-white">利尼尔 CRM</span>
          </div>

          <p className="mt-6 text-lg leading-relaxed text-brand-50">
            从客户到交付的端到端业务管理
          </p>

          <ul className="mt-10 space-y-5">
            {BRAND_FEATURES.map((feature) => (
              <li key={feature.text} className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-brand-50">
                  <Icon name={feature.icon} size={18} />
                </span>
                <span className="text-sm text-brand-50/90">{feature.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* 表单区：移动端全宽居中，大屏占右半侧 */}
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-elevation-lg">
          <div className="mb-6 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-xl font-bold text-white shadow-elevation-md">
              利
            </span>
            <h1 className="mt-4 text-xl font-semibold text-ink-primary">利尼尔 CRM 管理系统</h1>
            <p className="mt-1 text-xs text-ink-muted">Linier CRM Management System</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-ink-secondary">
                邮箱
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-ink-secondary">
                密码
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-md border border-border bg-surface py-2 pl-3 pr-10 text-sm text-ink-primary placeholder:text-ink-muted transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  placeholder="请输入密码"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-muted transition-colors hover:text-ink-primary focus:outline-none focus-visible:text-brand-600"
                >
                  <Icon name={showPassword ? "eye-off" : "eye"} size={18} />
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="rounded-md border border-status-danger-border bg-status-danger-bg px-3 py-2 text-sm text-status-danger-text">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-elevation-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "登录中…" : "登录"}
            </button>
          </form>

          {process.env.NODE_ENV === "development" && (
            <p className="mt-4 rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-2 text-xs text-status-warning-text">
              开发环境测试账号请参考仓库 .env.example（SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD）
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
