import { execSync } from "child_process";
import { readFileSync } from "fs";
import type { NextConfig } from "next";

/**
 * Build-time Release Metadata Injection（P0.5，CTO 16:27 指令；16:45 补强）
 *
 * version SSOT = root package.json；GIT_SHA/BUILD_ID/DEPLOYMENT_ENV 在构建时
 * 注入为 NEXT_PUBLIC_*。Footer 与 Dashboard System Overview 只消费这些构建注入值。
 *
 * 生产来源优先级（确定来源，不依赖 .git —— .dockerignore 排除 .git）：
 * - GIT_SHA：NEXT_PUBLIC_GIT_SHA（显式覆盖）→ RAILWAY_GIT_COMMIT_SHA（Railway 构建注入）
 *   → GITHUB_SHA（GitHub Actions）→ git rev-parse（仅本地非 Docker fallback）→ unknown
 * - BUILD_ID：NEXT_PUBLIC_BUILD_ID → GITHUB_RUN_ID → RAILWAY_DEPLOYMENT_ID
 *   → 短 SHA（来自 gitSha()）→ dev
 * - DEPLOYMENT_ENV：NEXT_PUBLIC_DEPLOYMENT_ENV → RAILWAY_ENVIRONMENT_NAME → NODE_ENV → development
 *
 * "unknown"/"dev"/空值视为占位符（isMeaningful 拒绝），避免 Dockerfile 默认值
 * 遮蔽真实平台变量。
 */
function rootVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));
    return typeof pkg?.version === "string" ? pkg.version : "0.0.0-dev";
  } catch {
    return "0.0.0-dev";
  }
}

function isMeaningful(v: string | undefined): v is string {
  return v !== undefined && v !== "" && v !== "unknown" && v !== "dev";
}

function gitSha(): string {
  if (isMeaningful(process.env.NEXT_PUBLIC_GIT_SHA)) return process.env.NEXT_PUBLIC_GIT_SHA;
  if (isMeaningful(process.env.RAILWAY_GIT_COMMIT_SHA)) return process.env.RAILWAY_GIT_COMMIT_SHA;
  if (isMeaningful(process.env.GITHUB_SHA)) return process.env.GITHUB_SHA;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function buildId(): string {
  if (isMeaningful(process.env.NEXT_PUBLIC_BUILD_ID)) return process.env.NEXT_PUBLIC_BUILD_ID;
  if (isMeaningful(process.env.GITHUB_RUN_ID)) return process.env.GITHUB_RUN_ID;
  if (isMeaningful(process.env.RAILWAY_DEPLOYMENT_ID)) return process.env.RAILWAY_DEPLOYMENT_ID;
  const sha = gitSha();
  return sha !== "unknown" && sha !== "dev" ? sha.slice(0, 8) : "dev";
}

function deploymentEnv(): string {
  if (isMeaningful(process.env.NEXT_PUBLIC_DEPLOYMENT_ENV)) return process.env.NEXT_PUBLIC_DEPLOYMENT_ENV;
  if (isMeaningful(process.env.RAILWAY_ENVIRONMENT_NAME)) return process.env.RAILWAY_ENVIRONMENT_NAME;
  return process.env.NODE_ENV ?? "development";
}

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@nilier-crm/ui", "@nilier-crm/shared", "@nilier-crm/config", "@nilier-crm/types"],
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: rootVersion(),
    NEXT_PUBLIC_GIT_SHA: gitSha(),
    NEXT_PUBLIC_BUILD_ID: buildId(),
    NEXT_PUBLIC_DEPLOYMENT_ENV: deploymentEnv(),
  },
};

export default nextConfig;
