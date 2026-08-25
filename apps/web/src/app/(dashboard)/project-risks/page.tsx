"use client";

/**
 * Project Risks — 项目风险引导页（UI-06 Opportunity + Project 现代重构）
 *
 * 风险登记/应对/责任人/关闭状态在「项目管理 → 项目详情 → 风险」Tab 内维护（B2-1B 已交付完整 CRUD），
 * 本独立页仅做引导，不建平行 CRUD（避免业务真相重复）。
 * UI-06：与项目详情 Risk Tab 视觉统一（图标 + 说明 + CTA，EmptyState 规范），animate-page-in 入场。
 */
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage } from "@/components/workspace";
import { EmptyState } from "@/components/ui/empty-state";
import { BUTTON_PRIMARY_CLASS } from "@/lib/ui-classes";

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("project", "view")}>
      <AppPage>
        <div className="animate-page-in border-border bg-surface shadow-elevation-sm mx-auto max-w-2xl overflow-hidden rounded-lg border">
          <EmptyState
            icon={(
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
            )}
            title="项目风险"
            description="项目风险登记、应对方案、责任人与关闭状态在「项目管理 → 项目详情 → 风险」Tab 内维护，请前往项目管理查看。"
            action={(
              <Link href="/projects" className={BUTTON_PRIMARY_CLASS}>
                前往项目管理
              </Link>
            )}
          />
        </div>
      </AppPage>
    </PermissionGuard>
  );
}
