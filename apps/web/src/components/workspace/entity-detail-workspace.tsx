'use client';

/**
 * EntityDetailWorkspace — 详情工作区（F2-1 UI System Foundation）
 *
 * 统一详情页结构：Header（标题 + 状态 + 返回）→ Summary（概览）→
 * Actions（按状态机开放的操作）→ Sections/Tabs（业务内容）→ Audit（审计时间线）。
 *
 * 状态机规则由业务层解析后传入（actions 已按当前状态过滤/禁用），
 * 本组件只负责承载展示，不发明规则。
 */
import { PageHeader } from './page-header';
import { StatusBadge } from './status-badge';
import type { StatusTone } from '@/components/design-system';

interface EntityDetailWorkspaceProps {
  title: string;
  description?: string;
  backHref?: string;
  /** 当前状态（内部 key 保留真实 enum） */
  status?: string;
  statusLabel?: string;
  statusTone?: StatusTone;
  /** 状态旁的操作区（StateActionBar 等） */
  actions?: React.ReactNode;
  /** 概览摘要区（键值网格等） */
  summary?: React.ReactNode;
  /** 业务内容区（Sections / Tabs） */
  children: React.ReactNode;
  /** 审计时间线区（AuditTimeline 等） */
  audit?: React.ReactNode;
}

export function EntityDetailWorkspace({
  title,
  description,
  backHref,
  status,
  statusLabel,
  statusTone,
  actions,
  summary,
  children,
  audit,
}: EntityDetailWorkspaceProps) {
  return (
    <div className="border-border bg-surface shadow-elevation-sm overflow-hidden rounded-lg border">
      <PageHeader
        title={title}
        description={description}
        backHref={backHref}
        actions={
          status || actions ? (
            <div className="flex flex-wrap items-center gap-2">
              {status ? (
                <StatusBadge status={status} label={statusLabel} tone={statusTone} />
              ) : null}
              {actions}
            </div>
          ) : undefined
        }
      />
      {summary ? <div className="border-border border-b px-4 py-4 md:px-6">{summary}</div> : null}
      <div className="px-4 py-4 md:px-6">{children}</div>
      {audit ? <div className="border-border border-t px-4 py-4 md:px-6">{audit}</div> : null}
    </div>
  );
}
