import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CustomerPicker, type CustomerOption } from "@/components/customer-pool/customer-picker";

const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
}));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...mod, apiFetch: mockApiFetch };
});

const CUSTOMER: CustomerOption = {
  id: "bp-1",
  code: "BP-C-0001",
  name: "某机床制造有限公司",
  region: "华东",
  type: "CUSTOMER",
};
const BOTH: CustomerOption = {
  id: "bp-2",
  code: "BP-B-0001",
  name: "华东机电贸易有限公司",
  region: "华南",
  type: "BOTH",
};
const SUPPLIER: CustomerOption = {
  id: "bp-3",
  code: "BP-S-0001",
  name: "华南轴承科技有限公司",
  region: "华南",
  type: "SUPPLIER",
};

/** 按 type 参数返回对应 mock 结果（选择器只请求 CUSTOMER / BOTH，绝不请求 SUPPLIER） */
function mockSearch(partners: CustomerOption[]) {
  mockApiFetch.mockImplementation((url: string) => {
    if (url.includes("type=CUSTOMER")) {
      return Promise.resolve({ success: true as const, data: partners.filter((p) => p.type === "CUSTOMER") });
    }
    if (url.includes("type=BOTH")) {
      return Promise.resolve({ success: true as const, data: partners.filter((p) => p.type === "BOTH") });
    }
    return Promise.reject(new Error("unexpected type filter: " + url));
  });
}

describe("CustomerPicker（FRT-03 #2：手工入池客户选择器，显示 code+name+region，仅 CUSTOMER/BOTH）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("搜索结果展示 code + name + region + 类型", async () => {
    mockSearch([CUSTOMER, SUPPLIER]);
    const onChange = vi.fn();
    render(<CustomerPicker value={null} onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "机床" } });

    await waitFor(() => {
      expect(screen.getByText("某机床制造有限公司")).toBeInTheDocument();
    });
    expect(screen.getByText("（BP-C-0001）")).toBeInTheDocument();
    expect(screen.getByText("区域：华东")).toBeInTheDocument();
  });

  it("只允许选择 CUSTOMER / BOTH——SUPPLIER 不会出现在结果中，也不会发出 SUPPLIER 查询", async () => {
    mockSearch([CUSTOMER, BOTH, SUPPLIER]);
    const onChange = vi.fn();
    render(<CustomerPicker value={null} onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "机电" } });

    await waitFor(() => {
      expect(screen.getByText("华东机电贸易有限公司")).toBeInTheDocument();
    });
    // 两次查询：type=CUSTOMER 与 type=BOTH（后端 isPartnerPoolEligible 契约）
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    const urls = mockApiFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("type=CUSTOMER"))).toBe(true);
    expect(urls.some((u) => u.includes("type=BOTH"))).toBe(true);
    expect(urls.some((u) => u.includes("type=SUPPLIER"))).toBe(false);
    // SUPPLIER 不渲染
    expect(screen.queryByText("华南轴承科技有限公司")).not.toBeInTheDocument();
  });

  it("选择客户后回填并回调 onChange；点「更换客户」可清除", async () => {
    mockSearch([CUSTOMER]);
    const onChange = vi.fn();
    render(<CustomerPicker value={null} onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "机床" } });
    const optionButton = await screen.findByRole("button", { name: /某机床制造有限公司/ });
    fireEvent.click(optionButton);

    expect(onChange).toHaveBeenCalledWith(CUSTOMER);
  });

  it("已选中状态展示客户摘要（code/name/region）", () => {
    render(<CustomerPicker value={CUSTOMER} onChange={vi.fn()} />);
    expect(screen.getByText("某机床制造有限公司")).toBeInTheDocument();
    expect(screen.getByText("（BP-C-0001）")).toBeInTheDocument();
    expect(screen.getByText("区域：华东")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更换客户" })).toBeInTheDocument();
  });

  it("搜索失败展示真实错误而非空态", async () => {
    mockApiFetch.mockRejectedValue(new Error("network down"));
    render(<CustomerPicker value={null} onChange={vi.fn()} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "机床" } });

    await waitFor(() => {
      expect(screen.getByText(/客户搜索失败/)).toBeInTheDocument();
    });
  });
});
