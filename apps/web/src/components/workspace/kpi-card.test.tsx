import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { KpiCard } from "./kpi-card";

describe("KpiCard — 现代 KPI 数字卡片（UI-03）", () => {
  it("渲染 label / 数值 / hint", () => {
    render(<KpiCard label="本月订单数" value={12} hint="不含草稿/已取消" />);
    expect(screen.getByText("本月订单数")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("不含草稿/已取消")).toBeInTheDocument();
  });

  it("数值卡片带 tabular-nums 等宽数字类", () => {
    const { container } = render(<KpiCard label="本月订单数" value={12} />);
    expect(container.querySelector(".tabular-nums")).toBeTruthy();
  });

  it("金额模式渲染前缀 + 2 位小数（AnimatedMoney）", () => {
    const { container } = render(<KpiCard label="本月销售金额" value="888888.50" money prefix="¥" />);
    // AnimatedNumber 初始即显示最终值（无 from 动画）
    expect(container.textContent).toContain("¥");
    expect(container.textContent).toContain("888,888.50");
  });

  it("图标与图标底可渲染", () => {
    const { container } = render(
      <KpiCard label="在册客户" value={42} icon={<span data-testid="icon" />} iconClass="bg-brand-50 text-brand-600" />,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(container.querySelector(".bg-brand-50")).toBeTruthy();
  });
});
