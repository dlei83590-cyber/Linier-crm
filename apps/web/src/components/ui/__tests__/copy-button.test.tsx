import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CopyButton } from "../copy-button";
import { ToastProvider } from "../toast";

describe("CopyButton — 复制按钮", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("点击复制并 Toast 成功", async () => {
    render(
      <ToastProvider>
        <CopyButton text="SO-2026-0001" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("SO-2026-0001");
    });
    expect(await screen.findByText("已复制")).toBeTruthy();
  });

  it("复制失败 Toast 错误", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(
      <ToastProvider>
        <CopyButton text="X" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    expect(await screen.findByText("复制失败")).toBeTruthy();
  });
});
