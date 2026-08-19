"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { type SessionUser } from "@/lib/session-context";
import { setAuthToken } from "@/lib/auth-token";

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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-canvas to-slate-100 px-4">
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
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              placeholder="请输入密码"
            />
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
    </div>
  );
}