import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DetailTabs, TabContent } from "./detail-tabs";

const TABS = [
  { key: "overview", label: "概览" },
  { key: "activity", label: "活动/跟进" },
  { key: "products", label: "产品" },
];

describe("DetailTabs — Customer 360 Tab 导航（FE 2.0）", () => {
  it("渲染全部 tab 文案，激活 tab aria-selected=true", () => {
    render(<DetailTabs tabs={TABS} active="overview" onChange={() => undefined} />);
    for (const t of TABS) {
      expect(screen.getByRole("tab", { name: t.label })).toBeInTheDocument();
    }
    expect(screen.getByRole("tab", { name: "概览" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "产品" })).toHaveAttribute("aria-selected", "false");
  });

  it("点击非激活 tab 触发 onChange(key)", () => {
    const onChange = vi.fn();
    render(<DetailTabs tabs={TABS} active="overview" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "产品" }));
    expect(onChange).toHaveBeenCalledWith("products");
    // 点击已激活 tab 不重复触发
    fireEvent.click(screen.getByRole("tab", { name: "概览" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("TabContent 渲染 children（内容容器）", () => {
    render(
      <TabContent tab="overview">
        <p>概览内容</p>
      </TabContent>,
    );
    expect(screen.getByText("概览内容")).toBeInTheDocument();
  });
});
