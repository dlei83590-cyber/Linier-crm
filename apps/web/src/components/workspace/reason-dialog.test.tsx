import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReasonDialog } from "@/components/workspace/reason-dialog";

/**
 * FE2.0 UI-10 — ReasonDialog（驳回/冲销原因表单对话框，替换 window.prompt）。
 * 关键约束：必填原因（确认按钮在空白/纯空格时禁用）、Esc/遮罩取消、busy 禁用、错误回显。
 */
function setup(overrides: Partial<ComponentProps<typeof ReasonDialog>> = {}) {
  const props = {
    open: true,
    title: "驳回报销申请",
    description: "驳回后申请人可改稿并重新提交。",
    label: "驳回原因",
    value: "",
    onChange: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<ReasonDialog {...props} />);
  return props;
}

describe("ReasonDialog（FE2.0 UI-10）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("open=false 时不渲染", () => {
    const { container } = render(
      <ReasonDialog open={false} title="t" label="l" value="" onChange={vi.fn()} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("空白原因时确认按钮禁用并提示必填", () => {
    setup();
    const confirm = screen.getByRole("button", { name: "确认" });
    expect(confirm).toBeDisabled();
    expect(screen.getByText("请填写原因（必填）")).toBeInTheDocument();
  });

  it("纯空格原因同样视为无效（trim 后校验）", () => {
    setup({ value: "   " });
    expect(screen.getByRole("button", { name: "确认" })).toBeDisabled();
  });

  it("输入有效原因后确认可用", () => {
    setup({ value: "发票金额与报销金额不一致" });
    expect(screen.getByRole("button", { name: "确认" })).toBeEnabled();
  });

  it("输入触发 onChange 回传", () => {
    const onChange = vi.fn();
    setup({ onChange });
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "凭证缺失" } });
    expect(onChange).toHaveBeenCalledWith("凭证缺失");
  });

  it("busy 期间确认/取消禁用且显示处理中", () => {
    setup({ busy: true, value: "原因" });
    expect(screen.getByRole("button", { name: /处理中/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  });

  it("服务端错误回显到对话框内（不伪装成空态）", () => {
    setup({ error: "409 VERSION_CONFLICT（版本冲突，请刷新后重试）" });
    expect(screen.getByRole("alert")).toHaveTextContent("409 VERSION_CONFLICT");
  });

  it("Esc 触发 onCancel", () => {
    const onCancel = vi.fn();
    setup({ onCancel });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("点击确认触发 onConfirm（原因有效时）", () => {
    const onConfirm = vi.fn();
    setup({ value: "原因有效", onConfirm });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
