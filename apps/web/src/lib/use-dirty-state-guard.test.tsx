import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, screen, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useDirtyStateGuard } from "@/lib/use-dirty-state-guard";

/**
 * CC-10 — useDirtyStateGuard：离开确认从原生 window.confirm 迁移为
 * 应用内 ConfirmDialog（红线：禁止原生弹窗，替代组件 components/ui/confirm-dialog）。
 * 不变量：非 dirty 直接放行；dirty 时 confirmLeave 返回待决 Promise 并渲染
 * 确认对话框；对话框「离开」resolve(true)、「取消」resolve(false)。
 * Harness 必须真实渲染 leaveConfirmDialog（renderHook 只返回元素，不挂载 DOM）。
 */
interface GuardRef {
  confirmLeave: () => Promise<boolean>;
  leaveConfirmDialog: ReactNode;
}

const guardRef: { current: GuardRef | null } = { current: null };

function Harness({ dirty, message }: { dirty: boolean; message?: string }) {
  const guard = useDirtyStateGuard({ dirty, message });
  guardRef.current = guard;
  return <>{guard.leaveConfirmDialog}</>;
}

describe("useDirtyStateGuard（CC-10）", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    guardRef.current = null;
  });

  it("未修改（dirty=false）时 confirmLeave 立即放行且不弹窗", async () => {
    render(<Harness dirty={false} />);
    await expect(guardRef.current!.confirmLeave()).resolves.toBe(true);
    expect(guardRef.current!.leaveConfirmDialog).toBeNull();
  });

  it("dirty=true 时 confirmLeave 返回待决 Promise 并渲染确认对话框", () => {
    render(<Harness dirty message="有未保存的修改，确定离开？" />);
    let resolved: boolean | null = null;
    act(() => {
      void guardRef.current!.confirmLeave().then((v) => {
        resolved = v;
      });
    });
    expect(guardRef.current!.leaveConfirmDialog).not.toBeNull();
    expect(screen.getByText("有未保存的修改，确定离开？")).toBeInTheDocument();
    expect(resolved).toBeNull();
  });

  it("对话框「离开」确认后 resolve(true) 且对话框关闭", async () => {
    render(<Harness dirty />);
    let resolved: boolean | null = null;
    act(() => {
      void guardRef.current!.confirmLeave().then((v) => {
        resolved = v;
      });
    });
    act(() => {
      screen.getByRole("button", { name: "离开" }).click();
    });
    // Promise resolve 在微任务队列，等待其 flush（非 dirty 直通路径为同步 Promise）
    await waitFor(() => {
      expect(resolved).toBe(true);
    });
    await waitFor(() => {
      expect(guardRef.current!.leaveConfirmDialog).toBeNull();
    });
  });

  it("对话框「取消」后 resolve(false)", async () => {
    render(<Harness dirty />);
    let resolved: boolean | null = null;
    act(() => {
      void guardRef.current!.confirmLeave().then((v) => {
        resolved = v;
      });
    });
    act(() => {
      screen.getByRole("button", { name: "取消" }).click();
    });
    await waitFor(() => {
      expect(resolved).toBe(false);
    });
  });
});
