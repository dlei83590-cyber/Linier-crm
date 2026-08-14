'use client';

/**
 * EntityFormWorkspace — 表单工作区（F2-1 UI System Foundation）
 *
 * 统一 Create/Edit 表单结构：Header → Sections（分区）→ Lines（行编辑）→
 * Validation（校验错误）→ Save/Cancel。
 * - 校验错误与提交错误统一经 ErrorPanel 呈现（禁止裸堆栈）
 * - submitting 期间 Save/Cancel 禁用，防止重复提交
 */
import type { ApiClientError } from '@/lib/api-client';
import { PageHeader } from './page-header';
import { ErrorPanel } from './error-panel';

interface EntityFormWorkspaceProps {
  title: string;
  description?: string;
  backHref?: string;
  mode: 'create' | 'edit';
  /** 表单分区/行编辑内容 */
  children: React.ReactNode;
  /** 提交中 */
  submitting: boolean;
  /** 提交/校验错误 */
  error?: ApiClientError | null;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
  cancelLabel?: string;
}

export function EntityFormWorkspace({
  title,
  description,
  backHref,
  mode,
  children,
  submitting,
  error,
  onSave,
  onCancel,
  saveLabel,
  cancelLabel = '取消',
}: EntityFormWorkspaceProps) {
  const saveText = saveLabel ?? (mode === 'create' ? '保存' : '保存修改');
  return (
    <div className="border-border bg-surface shadow-elevation-sm overflow-hidden rounded-lg border">
      <PageHeader
        title={title}
        description={description}
        backHref={backHref}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={submitting}
              className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? '提交中…' : saveText}
            </button>
          </div>
        }
      />
      <div className="space-y-6 px-4 py-4 md:px-6">
        {error ? <ErrorPanel error={error} /> : null}
        {children}
      </div>
    </div>
  );
}
