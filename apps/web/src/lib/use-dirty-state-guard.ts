"use client";

/**
 * useDirtyStateGuard — 表单未保存保护（F2-2 UX Hardening ①，CTO #11660）
 *
 * 统一 Dirty-State 纪律：
 * - browser beforeunload：dirty 时拦截刷新/关页
 * - confirmLeave()：供 Cancel / Back 显式确认（页面级统一调用）
 *
 * CC-10（Frontend Production-Test Gate）：离开确认从原生 window.confirm
 * 迁移为应用内 ConfirmDialog（红线：禁止原生弹窗；替代组件见
 * components/ui/confirm-dialog.tsx），confirmLeave 改为异步 Promise。
 *
 * 用法：
 *   const { confirmLeave, leaveConfirmDialog } = useDirtyStateGuard({ dirty, message });
 *   // 表单挂载 {leaveConfirmDialog}
 *   // Cancel 按钮：if (!(await confirmLeave())) return; onCancel();
 */
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export interface DirtyStateGuardOptions {
  /** 是否有未保存修改（Create 页填写内容后即 true） */
  dirty: boolean;
  /** 离开确认文案，缺省统一文案 */
  message?: string;
}

export interface DirtyStateGuard {
  /** 显式离开确认：dirty 时弹应用内对话框；resolve(true) 允许离开，false 取消 */
  confirmLeave: () => Promise<boolean>;
  /** 离开确认对话框（dirty 且请求确认时渲染；表单必须挂载） */
  leaveConfirmDialog: ReactElement | null;
}

interface PendingConfirm {
  resolve: (v: boolean) => void;
}

export function useDirtyStateGuard({
  dirty,
  message = "有未保存的修改，确定离开吗？",
}: DirtyStateGuardOptions): DirtyStateGuard {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, message]);

  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirmLeave = useCallback((): Promise<boolean> => {
    if (!dirty) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setPending({ resolve }));
  }, [dirty]);

  const leaveConfirmDialog = pending ? (
    <ConfirmDialog
      open
      title="有未保存的修改"
      description={message}
      confirmLabel="离开"
      tone="primary"
      onConfirm={() => {
        const resolve = pending.resolve;
        setPending(null);
        resolve(true);
      }}
      onCancel={() => {
        const resolve = pending.resolve;
        setPending(null);
        resolve(false);
      }}
    />
  ) : null;

  return { confirmLeave, leaveConfirmDialog };
}
