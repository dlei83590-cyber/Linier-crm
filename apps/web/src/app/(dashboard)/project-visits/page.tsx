"use client";

/**
 * Project Visits — 客户走访引导页（UI-05 与 visits 视觉统一）
 *
 * 走访/沟通记录在「项目管理 → 项目详情 → 走访」Tab 内维护（B2-1B 已交付完整 CRUD），
 * 本独立页仅做引导，不建平行 CRUD（避免业务真相重复）。
 *
 * UI-05：与拜访计划页同一视觉语言——Surface 卡片 + elevation、customer-project 域 Accent、
 * Lucide 风格图标 + 说明 + 主 CTA（不再自造裸链接按钮）。
 */
import Link from "next/link";
import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { AppPage } from "@/components/workspace";
import { BUTTON_PRIMARY_CLASS } from "@/lib/ui-classes";

export default function Page() {
  return (
    <PermissionGuard permission={actionPermission("project", "view")}>
      <AppPage>
        <div className="mx-auto max-w-2xl">
          {/* 域 Accent 顶部指示条（customer-project） */}
          <div className="h-1 rounded-t-lg bg-domain-customer-project-500" aria-hidden="true" />
          <div className="rounded-b-lg border border-t-0 border-border bg-surface px-8 py-10 text-center shadow-elevation-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-domain-customer-project-50 text-domain-customer-project-600">
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-ink-primary">客户走访</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-secondary">
              客户走访与沟通记录（含下次行动与提醒）在「项目管理 → 项目详情 → 走访」Tab 内维护，
              请前往项目管理查看。
            </p>
            <div className="mt-6">
              <Link href="/projects" className={BUTTON_PRIMARY_CLASS}>
                前往项目管理
              </Link>
            </div>
          </div>
        </div>
      </AppPage>
    </PermissionGuard>
  );
}
