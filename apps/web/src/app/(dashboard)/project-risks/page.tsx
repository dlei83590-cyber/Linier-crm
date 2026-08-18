"use client";

/**
 * Project Risks — 项目风险引导页（Pending Pages Completion Gate — Batch 3）
 *
 * 风险登记/应对/责任人/关闭状态在「项目管理 → 项目详情 → 风险」Tab 内维护（B2-1B 已交付完整 CRUD），
 * 本独立页仅做引导，不建平行 CRUD（避免业务真相重复）。
 */
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage } from "@/components/workspace";

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("project", "view")}>
      <AppPage>
        <div className="border-border bg-surface shadow-elevation-sm mx-auto max-w-2xl rounded-lg border p-8 text-center">
          <h1 className="text-lg font-semibold text-ink-primary">项目风险</h1>
          <p className="mt-2 text-sm text-ink-secondary">
            项目风险登记、应对方案、责任人与关闭状态在「项目管理 → 项目详情 → 风险」Tab 内维护，
            请前往项目管理查看。
          </p>
          <Link
            href="/projects"
            className="bg-brand-600 hover:bg-brand-700 mt-6 inline-block rounded-md px-4 py-2 text-sm font-medium text-white"
          >
            前往项目管理
          </Link>
        </div>
      </AppPage>
    </PermissionGuard>
  );
}