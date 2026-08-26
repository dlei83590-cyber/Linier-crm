import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "../button";

describe("Button — FE 2.0 UI-01 按钮基元", () => {
  it("primary 默认渲染品牌色类", () => {
    render(<Button>保存</Button>);
    const btn = screen.getByRole("button", { name: "保存" });
    expect(btn.className).toContain("bg-brand-600");
    expect(btn.className).toContain("text-white");
    expect(btn).toHaveAttribute("type", "button");
  });

  it("variants 输出对应视觉类", () => {
    const { rerender } = render(<Button variant="secondary">a</Button>);
    expect(screen.getByRole("button").className).toContain("border-border");
    rerender(<Button variant="ghost">b</Button>);
    expect(screen.getByRole("button").className).toContain("hover:bg-surface-hover");
    rerender(<Button variant="danger">c</Button>);
    expect(screen.getByRole("button").className).toContain("bg-rose-600");
    rerender(<Button variant="link">d</Button>);
    expect(screen.getByRole("button").className).toContain("underline-offset-4");
  });

  it("sizes 输出高度类", () => {
    const { rerender } = render(<Button size="sm">s</Button>);
    expect(screen.getByRole("button").className).toContain("h-8");
    rerender(<Button size="md">m</Button>);
    expect(screen.getByRole("button").className).toContain("h-10");
    rerender(<Button size="lg">l</Button>);
    expect(screen.getByRole("button").className).toContain("h-11");
  });

  it("loading 禁用按钮并 aria-busy", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        提交
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disabled 禁止点击", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        禁用
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
