import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, screen, cleanup } from "@testing-library/react";
import { useDirtyStateGuard } from "@/lib/use-dirty-state-guard";

/**
 * CC-10 — useDirtyStateGuard：离开确认从原生 window.confirm 迁移为
 * 应用内 ConfirmDialog（红线：禁止原生弹窗，替代组件 components/ui/confirm-dialog）。
 * 不变量：非 dirty 直接放行；dirty 时 confirmLeave 返回待决 Promise 并渲染
 * 确认对话框；对话框「离开」resolve(true)、「取消」resolve(false)。
 */
describe("useDirtyStateGuard（CC-10）", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("未修改（dirty=false）时 confirmLeave 立即放行且不弹窗", async () => {
    const { result } = renderHook(() => useDirtyStateGuard({ dirty: false }));
    await expect(result.current.confirmLeave()).resolves.toBe(true);
    expect(result.current.leaveConfirmDialog).toBeNull();
  });

  it("dirty=true 时 confirmLeave 返回待决 Promise 并渲染确认对话框", () => {
    const { result } = renderHook(() =>
      useDirtyStateGuard({ dirty: true, message: "有未保存的修改，确定离开？" }),
    );
    let resolved: boolean | null = null;
    act(() => {
      void result.current.confirmLeave().then((v) => {
        resolved = v;
      });
    });
    expect(result.current.leaveConfirmDialog).not.toBeNull();
    expect(screen.getByText("有未保存的修改，确定离开？")).toBeInTheDocument();
    expect(resolved).toBeNull();
  });

  it("对话框「离开」确认后 resolve(true) 且对话框关闭", () => {
    const { result } = renderHook(() => useDirtyStateGuard({ dirty: true }));
    let resolved: boolean | null = null;
    act(() => {
      void result.current.confirmLeave().then((v) => {
        resolved = v;
      });
    });
    act(() => {
      screen.getByRole("button", { name: "离开" }).click();
    });
    expect(resolved).toBe(true);
    expect(result.current.leaveConfirmDialog).toBeNull();
  });

  it("对话框「取消」后 resolve(false)", () => {
    const { result } = renderHook(() => useDirtyStateGuard({ dirty: true }));
    let resolved: boolean | null = null;
    act(() => {
      void result.current.confirmLeave().then((v) => {
        resolved = v;
      });
    });
    act(() => {
      screen.getByRole("button", { name: "取消" }).click();
    });
    expect(resolved).toBe(false);
  });
});
