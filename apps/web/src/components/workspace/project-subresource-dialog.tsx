"use client";

/**
 * ProjectSubresourceDialog — Project 子资源写操作共享交互框架（F2-4B2-1A，CTO #12350/#12368）
 *
 * 职责（只做交互框架，不感知任何资源专属字段）：
 * - open / close
 * - title
 * - mode = create | edit
 * - children（资源专属 form fields 由调用方传入）
 * - submit loading（saving）
 * - ApiClientError 展示
 * - VERSION_CONFLICT 专用 stale panel +「重新加载最新数据」（onReload 只做单资源 GET，保持 dialog open）
 * - Cancel / Save
 *
 * 不负责：stakeholder role / member userId / milestone status / task milestoneId 等资源字段语义。
 * B2-1B 的 Risk / Visit / Product / Tag 可复用此壳。
 */
import type { ReactNode } from "react";
import { describeStatus } from "@/lib/api-client";
import type { ApiClientError } from "@/lib/api-client";

export interface ProjectSubresourceDialogProps {
  open: boolean;
  mode: "create" | "edit";
  title: string;
  saving?: boolean;
  error?: ApiClientError | null;
  /** selector 数据未就绪/失败时禁用 Save（B2-1B，CTO #13762） */
  submitDisabled?: boolean;
  /** VERSION_CONFLICT stale panel 的「重新加载最新数据」动作：单资源 GET → 覆盖 fields + version → 清 stale error */
  onReload?: () => void;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}

export function ProjectSubresourceDialog({
  open,
  mode,
  title,
  saving = false,
  error = null,
  onReload,
  onSubmit,
  onClose,
  children,
}: ProjectSubresourceDialogProps) {
  if (!open) return null;

  const isVersionConflict = error?.code === "VERSION_CONFLICT";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="border-border bg-surface shadow-elevation-lg flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-border flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-ink-primary text-base font-semibold">{title}</h2>
          <span className="text-ink-muted text-xs">{mode === "create" ? "新增" : "编辑"}</span>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {error && (
            <div className="border-red-200 mb-4 rounded-md border bg-red-50 p-3 text-sm text-red-700">
              <p>
                {describeStatus(error.status)}：{error.message}
                {error.code ? `（${error.code}）` : ""}
              </p>
              {isVersionConflict && (
                <div className="mt-2">
                  <p className="text-xs">
                    该记录已被其他操作更新，请重新加载最新数据后再编辑。
                  </p>
                  <button
                    type="button"
                    onClick={onReload}
                    disabled={saving}
                    className="border-red-300 mt-2 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    重新加载最新数据
                  </button>
                </div>
              )}
            </div>
          )}

          {children}
        </div>

        <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={saving || isVersionConflict || submitDisabled}
            className="bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
