import { describe, it, expect } from "vitest";
import {
  DEFAULT_INITIAL_PASSWORD,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isDefaultInitialPassword,
  isStrongPassword,
  passwordPolicyErrors,
  strongPasswordSchema,
} from "./index";

/**
 * ADR-0059 密码策略单测（SSOT = packages/shared/src/validators）
 * 规则：大小写字母 + 数字组合，长度 ≥ 8 位（≤ 128）。
 * 验证事实源 = GitHub CI（本地不运行测试）。
 */
describe("ADR-0059 强密码策略", () => {
  it("合规：大小写字母 + 数字且长度 ≥ 8 → 通过", () => {
    expect(passwordPolicyErrors("Abcd1234")).toEqual([]);
    expect(isStrongPassword("Abcd1234")).toBe(true);
    expect(strongPasswordSchema.safeParse("Abcd1234").success).toBe(true);
  });

  it("长度不足（< 8）→ 拒绝", () => {
    expect(passwordPolicyErrors("Abc1234")).toContain(`密码长度至少 ${PASSWORD_MIN_LENGTH} 位`);
    expect(isStrongPassword("Abc1234")).toBe(false);
  });

  it("超过最大长度（> 128）→ 拒绝", () => {
    const long = "Ab1" + "x".repeat(PASSWORD_MAX_LENGTH);
    expect(passwordPolicyErrors(long)).toContain(`密码长度最多 ${PASSWORD_MAX_LENGTH} 位`);
  });

  it("缺少大写字母 → 拒绝", () => {
    expect(passwordPolicyErrors("abcd1234")).toContain("密码必须包含大写字母");
  });

  it("缺少小写字母 → 拒绝", () => {
    expect(passwordPolicyErrors("ABCD1234")).toContain("密码必须包含小写字母");
  });

  it("缺少数字 → 拒绝", () => {
    expect(passwordPolicyErrors("Abcdefgh")).toContain("密码必须包含数字");
  });

  it("全数字 / 全字母 → 拒绝（组合要求）", () => {
    expect(isStrongPassword("12345678")).toBe(false);
    expect(isStrongPassword("abcdefgh")).toBe(false);
  });

  it("固定初始密码 123456 不满足强密码策略（必须首次登录改密）", () => {
    expect(DEFAULT_INITIAL_PASSWORD).toBe("123456");
    expect(isStrongPassword(DEFAULT_INITIAL_PASSWORD)).toBe(false);
    expect(isDefaultInitialPassword("123456")).toBe(true);
    expect(isDefaultInitialPassword("Abcd1234")).toBe(false);
  });
});
