import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sparkline, Donut } from "../charts";

describe("Charts — 零依赖自绘 SVG 图表", () => {
  it("Sparkline 数据不足 2 点返回 null", () => {
    const { container } = render(<Sparkline data={[1]} />);
    expect(container.firstChild).toBeNull();
  });

  it("Sparkline 渲染 polyline 与面积路径", () => {
    const { container } = render(<Sparkline data={[2, 5, 3, 8]} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("role")).toBe("img");
    expect(container.querySelector("polyline")).not.toBeNull();
    expect(container.querySelector("path")).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 120 32");
  });

  it("Sparkline 自定义尺寸与语义类", () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3]} width={200} height={48} strokeClass="stroke-status-success-text" fillClass="fill-status-success-bg" />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 200 48");
    expect(container.querySelector("polyline")?.getAttribute("class")).toContain("stroke-status-success-text");
  });

  it("Donut 渲染空环（总值为 0）", () => {
    const { container } = render(<Donut segments={[{ value: 0, color: "#2563eb" }]} />);
    expect(container.querySelectorAll("circle").length).toBe(1); // 只有底环
  });

  it("Donut 按有效分段渲染并计算占比", () => {
    const { container } = render(
      <Donut segments={[{ value: 3, color: "#2563eb" }, { value: 1, color: "#10b981" }, { value: 0, color: "#f43f5e" }]} />,
    );
    // 底环 1 + 有效分段 2 = 3 个 circle
    expect(container.querySelectorAll("circle").length).toBe(3);
    const seg = container.querySelectorAll("circle")[1];
    expect(seg?.getAttribute("stroke")).toBe("#2563eb");
    const dash = seg?.getAttribute("stroke-dasharray") ?? "";
    // 3/4 周长 → dash 长度 = 0.75 * circumference
    const [len, gap] = dash.split(" ").map(Number);
    expect(len / (len + gap)).toBeCloseTo(0.75, 5);
  });

  it("Donut 中心合计文案", () => {
    render(<Donut segments={[{ value: 2, color: "#2563eb" }]} centerValue="12" centerLabel="总数" />);
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("总数")).toBeTruthy();
  });
});
