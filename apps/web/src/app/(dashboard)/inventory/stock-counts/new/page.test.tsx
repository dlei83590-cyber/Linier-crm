import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DensityProvider } from "@/lib/table-density-context";
import Page from "@/app/(dashboard)/inventory/stock-counts/new/page";

const { mockApiFetch, mockPush } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/session-context", () => ({
  useSession: () => ({
    state: {
      status: "authenticated",
      user: { id: "u-1", email: "a@b.c", name: "Admin", roles: ["SUPER_ADMIN"] },
    },
  }),
}));

import type * as ApiClientModule from "@/lib/api-client";
import { ApiClientError } from "@/lib/api-client";
vi.mock("@/lib/api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof ApiClientModule>();
  return { ...mod, apiFetch: mockApiFetch };
});

describe("新建库存盘点单（UI-09：EntityFormWorkspace 表单统一，无页面级 window.confirm）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("渲染统一表单工作区（标题/取消/保存）；保存 POST /api/stock-counts 后导航详情", async () => {
    mockApiFetch.mockResolvedValue({ success: true, data: { id: "sc-1" } });
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );

    expect(screen.getByText("新建库存盘点单")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建盘点单" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/备注/), { target: { value: "年中盘点" } });
    fireEvent.click(screen.getByRole("button", { name: "创建盘点单" }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/stock-counts",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("年中盘点"),
        }),
      );
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/inventory/stock-counts/sc-1");
    });
  });

  it("保存失败 → 展示 ErrorPanel（真实错误，不伪装成空态/成功）", async () => {
    mockApiFetch.mockRejectedValue(new ApiClientError(422, "服务端校验失败", "VALIDATION_ERROR"));
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );

    fireEvent.change(screen.getByLabelText(/备注/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "创建盘点单" }));

    await waitFor(() => {
      // 422 未在 ERROR_STATUS_MESSAGES 登记 → ErrorPanel 回退 "请求失败（HTTP 422）"；API message 原样透出
      expect(screen.getByText(/请求失败（HTTP 422）/)).toBeInTheDocument();
      expect(screen.getByText("服务端校验失败")).toBeInTheDocument();
      expect(screen.getByText(/错误码：VALIDATION_ERROR/)).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("未填写（未 dirty）时点击取消 → 直接返回列表（无 window.confirm 拦截）", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/inventory/stock-counts");
  });
});