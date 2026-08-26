"use client";

/**
 * EntityFormWorkspace — 表单工作区（F2-1 UI System Foundation + F2-2 UX Hardening）
 *
 * 统一 Create/Edit 表单结构：Header → Sections（分区）→ Lines（行编辑）→
 * Validation（校验错误）→ Save/Cancel。
 *
 * F2-2 UX Hardening（CTO #11660）：
 * - Dirty-State Protection：`dirty` 时挂 beforeunload + Cancel/Back 显式确认
 *   （共享 useDirtyStateGuard，Items/PriceLists 等全部表单统一接入）
 * - 409 VERSION_CONFLICT：不再只当普通 ErrorPanel —— 提供专用 conflict 面板
 *   （明确提示 stale + 「重新加载最新数据」按钮 → onReload），
 *   禁止 silent retry / 自动覆盖 / 自动重新 PATCH。
 */
import type { ApiClientError } from "@/lib/api-client";
import { isVersionConflict } from "@/lib/api-client";
import { useDirtyStateGuard } from "@/lib/use-dirty-state-guard";
import { PageHeader } from "./page-header";
import { Spinner } from "@/components/ui/skeleton";
import { ErrorPanel } from "./error-panel";

interface EntityFormWorkspaceProps {
  title: string;
  description?: string;
  backHref?: string;
  mode: "create" | "edit";
  /** 表单分区/行编辑内容 */
  children: React.ReactNode;
  /** 提交中 */
  submitting: boolean;
  /** 提交/校验错误 */
  error?: ApiClientError | null;
  /** 是否有未保存修改（F2-2 Dirty-State Guard；Create 页填写内容后即 true） */
  dirty?: boolean;
  /** 表单内容变更回调（内容容器 onInput 冒泡：input/select/textarea 输入即触发，用于 Create 页标记 dirty） */
  onDirty?: () => void;
  /** 409 VERSION_CONFLICT 时「重新加载最新数据」回调（重新 GET → 更新 version → 重置 dirty） */
  onReload?: () => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
  cancelLabel?: string;
  /** Dirty 离开确认文案 */
  dirtyMessage?: string;
}

export function EntityFormWorkspace({
  title,
  description,
  backHref,
  mode,
  children,
  submitting,
  error,
  dirty = false,
  onDirty,
  onReload,
  onSave,
  onCancel,
  saveLabel,
  cancelLabel = "取消",
  dirtyMessage = "有未保存的修改，确定离开吗？",
}: EntityFormWorkspaceProps) {
  const saveText = saveLabel ?? (mode === "create" ? "保存" : "保存修改");
  const { confirmLeave, leaveConfirmDialog } = useDirtyStateGuard({ dirty, message: dirtyMessage });

  const handleCancel = async () => {
    if (!(await confirmLeave())) return;
    onCancel();
  };

  const isConflict = isVersionConflict(error);

  return (
    <>
      <div className="border-border bg-surface shadow-elevation-sm overflow-hidden rounded-lg border">
      <PageHeader
        title={title}
        description={description}
        backHref={backHref}
        onBackClick={confirmLeave}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={submitting}
              className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={submitting}
              className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner />
                  提交中…
                </span>
              ) : (
                saveText
              )}
            </button>
          </div>
        }
      />
      <div className="space-y-6 px-4 py-4 md:px-6" onInput={onDirty}>
        {isConflict && onReload ? (
          <div
            role="alert"
            className="rounded-md border border-status-warning-border bg-status-warning-bg p-4"
          >
            <p className="text-sm font-medium text-status-warning-text">
              该记录已被其他操作更新，请重新加载最新数据后再编辑。
            </p>
            <button
              type="button"
              onClick={onReload}
              disabled={submitting}
              className="bg-brand-600 hover:bg-brand-700 mt-3 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              重新加载最新数据
            </button>
          </div>
        ) : error ? (
          <ErrorPanel error={error} />
        ) : null}
        {children}
      </div>
      {leaveConfirmDialog}
      </div>
    </>
  );
}