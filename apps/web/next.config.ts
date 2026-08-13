import { execSync } from "child_process";
import { readFileSync } from "fs";
import type { NextConfig } from "next";

/**
 * Build-time Release Metadata Injection（P0.5，CTO 16:27 指令）
 *
 * version SSOT = root package.json；GIT_SHA/BUILD_ID/DEPLOYMENT_ENV
 * 在构建时注入为 NEXT_PUBLIC_*（CI / Docker 可覆盖，本地 fallback）。
 * Footer 与 Dashboard System Overview 只消费这些构建注入值，不再硬编码。
 */
function rootVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));
    return typeof pkg?.version === "string" ? pkg.version : "0.0.0-dev";
  } catch {
    return "0.0.0-dev";
  }
}

function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
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
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION ?? rootVersion(),
    NEXT_PUBLIC_GIT_SHA: process.env.NEXT_PUBLIC_GIT_SHA ?? gitSha(),
    NEXT_PUBLIC_BUILD_ID: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
    NEXT_PUBLIC_DEPLOYMENT_ENV: process.env.NEXT_PUBLIC_DEPLOYMENT_ENV ?? "development",
  },
};

export default nextConfig;
