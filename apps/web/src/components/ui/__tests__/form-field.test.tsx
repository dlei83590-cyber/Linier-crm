import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormField } from "../form-field";
import { Input } from "../input";

describe("FormField — FE 2.0 UI-01 表单字段容器", () => {
  it("label + required 标记", () => {
    render(
      <FormField label="物料编码" required>
        <Input placeholder="输入编码" />
      </FormField>,
    );
    expect(screen.getByText("物料编码")).toBeInTheDocument();
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("error 渲染在 field 下方（role=alert，danger 色）", () => {
    render(
      <FormField label="数量" error="数量必须大于 0">
        <Input invalid />
      </FormField>,
    );
    const err = screen.getByRole("alert");
    expect(err).toHaveTextContent("数量必须大于 0");
    expect(err.className).toContain("text-status-danger-text");
  });

  it("hint 正常态展示，error 优先于 hint", () => {
    const { rerender } = render(
      <FormField label="备注" hint="选填">
        <Input />
      </FormField>,
    );
    expect(screen.getByText("选填")).toBeInTheDocument();
    rerender(
      <FormField label="备注" hint="选填" error="必填">
        <Input />
      </FormField>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("必填");
    expect(screen.queryByText("选填")).not.toBeInTheDocument();
  });
});
