import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DensityProvider } from "@/lib/table-density-context";
import { ToastProvider } from "@/components/ui/toast";
import Page from "@/app/(dashboard)/inventory/production-orders/[id]/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "po-1" }),
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

function orderDetail(status: string) {
  return {
    id: "po-1",
    orderNo: "PRD-2026-0001",
    productionType: "SELF_MANUFACTURE",
    plannedQty: "100",
    status,
    batchNo: null,
    productionDate: null,
    processingFee: null,
    movementGroupId: null,
    postedAt: null,
    version: 3,
    finishedItem: { id: "fg-1", code: "FG001", name: "成品A", stockUomId: null },
    warehouse: { id: "w-1", code: "WH1", name: "主仓" },
    supplier: null,
    bom: { id: "bom-1", bomNo: "BOM-FG001-1", bomVersion: 1, status: "ACTIVE" },
    lines: [
      {
        id: "l1",
        lineType: "MATERIAL",
        itemId: "rm-1",
        quantity: "5",
        unitCost: "12.00",
        amount: "60.00",
        remark: null,
        item: { code: "RM001", name: "钢材" },
        uom: { code: "TON", symbol: "吨" },
        warehouse: { name: "主仓" },
      },
    ],
  };
}

describe("生产/外协工单详情页（UI-09：状态机动作门 SUBMITTED ≠ POSTED）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("DRAFT → 显示 提交 + 取消 + 删除；不显示 过账（SUBMITTED 才过账）", async () => {
    mockApiFetch.mockResolvedValue({ success: true, data: orderDetail("DRAFT") });
    render(
      <DensityProvider>
        <ToastProvider>
          <Page />
        </ToastProvider>
      </DensityProvider>,
    );

    await screen.findByText(/PRD-2026-0001/);
    expect(screen.getByText("草稿")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /过账/ })).not.toBeInTheDocument();
    // 工单行金额/数量右对齐 tabular 数据展示
    expect(screen.getByText(/钢材/)).toBeInTheDocument();
  });

  it("SUBMITTED → 显示 过账（领料→入库）；提交动作不再出现", async () => {
    mockApiFetch.mockResolvedValue({ success: true, data: orderDetail("SUBMITTED") });
    render(
      <DensityProvider>
        <ToastProvider>
          <Page />
        </ToastProvider>
      </DensityProvider>,
    );

    await screen.findByText(/PRD-2026-0001/);
    expect(screen.getByText("已提交")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /过账/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("SUBMITTED → 点击过账消费后端契约（POST /post + version CAS）→ POSTED 后所有状态动作关闭", async () => {
    // 初始 SUBMITTED；POST /post 后 reload 返回 POSTED（不可逆事实）
    let current: "SUBMITTED" | "POSTED" = "SUBMITTED";
    mockApiFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes("/post") && init?.method === "POST") {
        current = "POSTED";
        return Promise.resolve({ success: true, data: orderDetail("POSTED") });
      }
      return Promise.resolve({ success: true, data: orderDetail(current) });
    });
    render(
      <DensityProvider>
        <ToastProvider>
          <Page />
        </ToastProvider>
      </DensityProvider>,
    );

    await screen.findByText(/PRD-2026-0001/);
    expect(screen.getByRole("button", { name: /过账/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /过账/ }));
    // 确认对话框（ConfirmActionDialog）→ 确认过账
    fireEvent.click(await screen.findByRole("button", { name: "确认过账" }));

    await waitFor(() => {
      expect(screen.getByText("已过账")).toBeInTheDocument();
    });
    // POST /post 携带 version CAS
    const postCall = mockApiFetch.mock.calls.find(
      (c) => String(c[0]).includes("/post"),
    );
    expect(postCall).toBeTruthy();
    expect(JSON.parse(String((postCall?.[1] as RequestInit | undefined)?.body ?? "{}"))).toHaveProperty("version", 3);
    // 过账后状态门关闭所有动作（POSTED 只读）
    expect(screen.queryByRole("button", { name: "提交" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /过账/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消" })).not.toBeInTheDocument();
  });
});