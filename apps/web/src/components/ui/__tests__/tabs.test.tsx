import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs } from "../tabs";

const items = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待处理" },
  { value: "done", label: "已完成" },
];

describe("Tabs — FE 2.0 UI-01 标签页", () => {
  it("受控激活项 aria-selected 正确", () => {
    render(<Tabs items={items} value="pending" onChange={vi.fn()} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
  });

  it("点击触发 onChange", () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "待处理" }));
    expect(onChange).toHaveBeenCalledWith("pending");
  });

  it("键盘 → 移动 roving tabindex（焦点不改变选中态）", () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="all" onChange={onChange} />);
    const first = screen.getAllByRole("tab")[0];
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getAllByRole("tab")[1]).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("pill variant 渲染", () => {
    render(<Tabs items={items} value="all" onChange={vi.fn()} variant="pill" />);
    expect(screen.getAllByRole("tab").length).toBe(3);
  });
});
