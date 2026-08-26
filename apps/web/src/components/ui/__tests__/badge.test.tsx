import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "../badge";

describe("Badge — FE 2.0 UI-01 徽章基元", () => {
  it("默认 neutral 渲染文案", () => {
    render(<Badge>草稿</Badge>);
    expect(screen.getByText("草稿")).toBeInTheDocument();
    expect(screen.getByText("草稿").className).toContain("rounded-full");
  });

  it("tone 输出语义色（inline style 引用 status tokens 的 CSS 变量；Phase 1 深色模式）", () => {
    const { rerender } = render(<Badge tone="success">已批准</Badge>);
    expect(screen.getByText("已批准").style.backgroundColor).toBe("var(--color-status-success-bg)");
    rerender(<Badge tone="danger">已取消</Badge>);
    expect(screen.getByText("已取消").style.color).toBe("var(--color-status-danger-text)");
  });

  it("dot 渲染状态圆点", () => {
    render(
      <Badge tone="info" dot>
        待处理
      </Badge>,
    );
    const dot = document.querySelector("span[aria-hidden='true']");
    expect(dot).not.toBeNull();
  });
});
