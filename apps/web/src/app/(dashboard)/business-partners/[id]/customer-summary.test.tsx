import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CustomerSummary, type CustomerSummaryData } from "./customer-summary";

const data: CustomerSummaryData = {
  contactCount: 3,
  opportunityCount: 5,
  latestActivity: { type: "FOLLOW_UP", occurredAt: "2026-08-01T08:00:00.000Z" },
  latestOrder: { id: "so-1", code: "SO-2026-0001", totalAmount: "1234.5", currency: "CNY" },
  orderCount: 7,
  approvalStatus: "APPROVED",
  isActive: true,
};

describe("CustomerSummary — Customer 360 摘要 KPI 条（FE 2.0）", () => {
  it("渲染全部 KPI：联系人/商机/最近跟进/最近订单/累计销售/客户状态", () => {
    render(<CustomerSummary data={data} />);
    expect(screen.getByText("联系人")).toBeInTheDocument();
    expect(screen.getByText("商机")).toBeInTheDocument();
    expect(screen.getByText("最近跟进")).toBeInTheDocument();
    expect(screen.getByText("最近订单")).toBeInTheDocument();
    expect(screen.getByText("累计销售")).toBeInTheDocument();
    expect(screen.getByText("客户状态")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("最近跟进 = 类型文案 + 日期（FOLLOW_UP → 跟进）", () => {
    render(<CustomerSummary data={data} />);
    expect(screen.getByText(/跟进 · /)).toBeInTheDocument();
  });

  it("最近订单显示单号 + 金额（tabular-nums 数值）", () => {
    render(<CustomerSummary data={data} />);
    // 外层 span 同时含单号+金额 → getAllByText（内外两层文本节点均匹配）
    expect(screen.getByText(/SO-2026-0001/)).toBeInTheDocument();
    expect(screen.getAllByText(/1,234.50/).length).toBeGreaterThan(0);
  });

  it("客户状态 = 审批徽标（已批准）+ 启用", () => {
    render(<CustomerSummary data={data} />);
    expect(screen.getByText("已批准")).toBeInTheDocument();
    expect(screen.queryByText("已停用")).not.toBeInTheDocument();
  });

  it("无跟进/无订单 → 诚实显示占位（禁止伪造数据）", () => {
    render(
      <CustomerSummary
        data={{
          ...data,
          latestActivity: null,
          latestOrder: null,
          approvalStatus: "DRAFT",
          isActive: false,
        }}
      />,
    );
    expect(screen.getByText("暂无跟进")).toBeInTheDocument();
    expect(screen.getByText("暂无订单")).toBeInTheDocument();
    expect(screen.getByText("草稿")).toBeInTheDocument();
    expect(screen.getByText("已停用")).toBeInTheDocument();
  });

  it("data=null（加载中）→ 骨架占位", () => {
    render(<CustomerSummary data={null} />);
    // 骨架为 aria-hidden 装饰；确认无 KPI 文案泄漏
    expect(screen.queryByText("累计销售")).not.toBeInTheDocument();
  });
});
