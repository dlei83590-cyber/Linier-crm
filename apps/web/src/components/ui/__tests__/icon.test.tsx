import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Icon } from "../icon";
import type { IconName } from "../icon";

describe("Icon — FE 2.0 UI-01 统一图标系统", () => {
  it("渲染 stroke SVG 并默认 aria-hidden", () => {
    const { container } = render(<Icon name="check" size={16} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("width", "16");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("未知图标名回退到 help 且不崩溃", () => {
    // IconName 为字符串联合（Record 键），运行期未知名回退 help，不崩溃
    const { container } = render(<Icon name={"not-a-real-icon" as IconName} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("aria-hidden=false 时可被读屏识别", () => {
    const { container } = render(<Icon name="info" aria-hidden={false} />);
    expect(container.querySelector("svg")).not.toHaveAttribute("aria-hidden");
  });
});
