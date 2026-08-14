"use client";

/**
 * useDirtyStateGuard — 表单未保存保护（F2-2 UX Hardening ①，CTO #11660）
 *
 * 统一 Dirty-State 纪律（此前为 Tier 1 成熟页面要求，F2-2 起 Workspace 表单全部接入）：
 * - browser beforeunload：dirty 时拦截刷新/关页
 * - confirmLeave()：供 Cancel / Back 显式确认（页面级统一调用）
 * - 不做复杂全局 Router interception（CTO：不需要）
 *
 * 用法：
 *   const { confirmLeave } = useDirtyStateGuard({ dirty, message });
 *   // Cancel 按钮：if (!confirmLeave()) return; onCancel();
 */
import { useEffect } from "react";

export interface DirtyStateGuardOptions {
  /** 是否有未保存修改（Create 页填写内容后即 true） */
  dirty: boolean;
  /** 离开确认文案，缺省统一文案 */
  message?: string;
}

export interface DirtyStateGuard {
  /** 显式离开确认：dirty 时弹窗；返回 true 允许离开，false 取消 */
  confirmLeave: () => boolean;
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

  const confirmLeave = (): boolean => {
    if (!dirty) return true;
    // eslint-disable-next-line no-alert -- 显式确认使用原生 confirm，避免引入对话框依赖
    return window.confirm(message);
  };

  return { confirmLeave };
}
