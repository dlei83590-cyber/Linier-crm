import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DensityProvider } from "@/lib/table-density-context";
import { ToastProvider } from "@/components/ui/toast";
import Page from "@/app/(dashboard)/inventory/boms/[id]/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "bom-1" }),
  useRouter: () => ({ push: vi.fn() }),
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
const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof ApiClientModule>();
  return { ...mod, apiFetch: mockApiFetch };
});

function bomDetail(status: string) {
  return {
    id: "bom-1",
    bomNo: "BOM-FG001-1",
    bomVersion: 1,
    status,
    isDefault: false,
    remark: null,
    version: 1,
    finishedItem: { id: "fg-1", code: "FG001", name: "成品A", model: null, sourcingType: "SELF_MANUFACTURED" },
    lines: [
      {
        id: "l1",
        componentItemId: "rm-1",
        componentUomId: "uom-1",
        qtyPerFinishedUnit: "0.05",
        lossRate: "0",
        sort: 1,
        componentItem: { code: "RM001", name: "钢材", model: null },
        componentUom: { code: "TON", symbol: "吨" },
      },
    ],
  };
}

describe("BOM 详情页（UI-09：状态/权限门 + StatusBadge 统一）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("DRAFT + approve/edit/delete 权限 → 显示 激活配方/编辑/删除；不显示不存在的动作", async () => {
    mockApiFetch.mockResolvedValue({ success: true, data: bomDetail("DRAFT") });
    render(
      <DensityProvider>
        <ToastProvider>
          <Page />
        </ToastProvider>
      </DensityProvider>,
    );

    await screen.findByText(/BOM-FG001-1/);
    expect(screen.getByText("草稿")).toBeInTheDocument(); // StatusBadge 中文业务名（key 保留 DRAFT）
    expect(screen.getByRole("button", { name: "激活配方" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    // 原料行渲染 + 系数右对齐 tabular 数据
    expect(screen.getByText(/钢材/)).toBeInTheDocument();
    expect(screen.getByText("0.05")).toBeInTheDocument();
    // BOM 不存在 submit/过账等单据动作（不造 backend 不存在的按钮）
    expect(screen.queryByRole("button", { name: /提交/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /过账/ })).not.toBeInTheDocument();
  });

  it("ACTIVE → 不显示 激活/编辑/删除（状态门），徽章为 生效", async () => {
    mockApiFetch.mockResolvedValue({ success: true, data: bomDetail("ACTIVE") });
    render(
      <DensityProvider>
        <ToastProvider>
          <Page />
        </ToastProvider>
      </DensityProvider>,
    );

    await screen.findByText(/BOM-FG001-1/);
    expect(screen.getByText("生效")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "激活配方" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  });

  it("加载失败 → 展示真实错误而非空态", async () => {
    mockApiFetch.mockRejectedValue(new Error("network down"));
    render(
      <DensityProvider>
        <ToastProvider>
          <Page />
        </ToastProvider>
      </DensityProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/加载配方失败/)).toBeInTheDocument();
    });
    expect(screen.queryByText("暂无原料行")).not.toBeInTheDocument();
  });
});