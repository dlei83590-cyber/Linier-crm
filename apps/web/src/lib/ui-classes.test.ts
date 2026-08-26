import { describe, it, expect } from "vitest";
import {
  BUTTON_PRIMARY_CLASS,
  BUTTON_SECONDARY_CLASS,
  BUTTON_GHOST_CLASS,
  BUTTON_DANGER_CLASS,
  BUTTON_LINK_CLASS,
  BUTTON_SM_CLASS,
  BUTTON_MD_CLASS,
  BUTTON_LG_CLASS,
  CARD_CLASS,
} from "@/lib/ui-classes";

describe("lib/ui-classes — FE 2.0 UI-01 控件类与 Button 组件对齐（向后兼容）", () => {
  it("旧常量原样保留（214 处存量消费不破坏）", () => {
    expect(BUTTON_PRIMARY_CLASS).toContain("bg-brand-600");
    expect(BUTTON_SECONDARY_CLASS).toContain("border-border");
    expect(CARD_CLASS).toContain("shadow-elevation-sm");
  });

  it("新增 ghost/danger/link 与 ui Button 视觉对齐", () => {
    expect(BUTTON_GHOST_CLASS).toContain("hover:bg-surface-hover");
    expect(BUTTON_DANGER_CLASS).toContain("bg-rose-600");
    expect(BUTTON_LINK_CLASS).toContain("underline-offset-4");
  });

  it("尺寸类与 Button size 对齐（sm=8 / md=10 / lg=11）", () => {
    expect(BUTTON_SM_CLASS).toContain("h-8");
    expect(BUTTON_MD_CLASS).toContain("h-10");
    expect(BUTTON_LG_CLASS).toContain("h-11");
  });
});
