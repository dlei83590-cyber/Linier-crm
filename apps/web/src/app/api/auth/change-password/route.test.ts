import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST /api/auth/change-password — ADR-0059 自助改密单测
 * 覆盖：未认证 401 / 策略不满足 400 PASSWORD_POLICY_VIOLATION / 当前密码错误 400 /
 *       新旧相同 400 / 合法改密 200（清零 mustChangePassword + passwordChangedAt + 审计）。
 * 验证事实源 = GitHub CI（本地不运行测试）。
 */

const { mockPrisma, authMocks } = vi.hoisted(() => ({
  mockPrisma: {} as Record<string, unknown>,
  authMocks: { authenticate: vi.fn(), writeAuditLog: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/api-helpers", () => ({
  authenticate: authMocks.authenticate,
  requestMeta: vi.fn().mockReturnValue({ requestId: "req-1" }),
  writeAuditLog: authMocks.writeAuditLog,
}));
vi.mock("@/lib/api/logger", () => ({ requestLog: vi.fn() }));

// bcryptjs 真实实现（12 rounds）在单测里偏慢：替换为可判定的确定性 mock
vi.mock("@/lib/auth", () => ({
  hashPassword: vi.fn(async (plain: string) => `hashed:${plain}`),
  verifyPassword: vi.fn(async (plain: string, hashed: string) => hashed === `hashed:${plain}`),
}));

import { POST } from "@/app/api/auth/change-password/route";

interface UserMock {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function userMock(): UserMock {
  return mockPrisma.user as UserMock;
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/change-password（ADR-0059）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user = { findUnique: vi.fn(), update: vi.fn() };
    authMocks.authenticate.mockResolvedValue({
      id: "u1",
      email: "a@b.c",
      name: "User",
      roles: ["MEMBER"],
      permissions: [],
      mustChangePassword: true,
      passwordChangedAt: null,
    });
    userMock().findUnique.mockResolvedValue({
      id: "u1",
      isActive: true,
      passwordHash: "hashed:123456",
      mustChangePassword: true,
    });
    userMock().update.mockResolvedValue({ id: "u1" });
    authMocks.writeAuditLog.mockResolvedValue(undefined);
  });

  it("未认证 → 401", async () => {
    authMocks.authenticate.mockResolvedValue(null);
    const res = await POST(makeRequest({ currentPassword: "123456", newPassword: "Abcd1234" }));
    expect(res.status).toBe(401);
  });

  it("新密码不满足强密码策略（纯数字）→ 400 PASSWORD_POLICY_VIOLATION，不写库", async () => {
    const res = await POST(makeRequest({ currentPassword: "123456", newPassword: "12345678" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("PASSWORD_POLICY_VIOLATION");
    expect(userMock().update).not.toHaveBeenCalled();
  });

  it("新密码缺少大写字母 → 400 PASSWORD_POLICY_VIOLATION（details 给出未满足项）", async () => {
    const res = await POST(makeRequest({ currentPassword: "123456", newPassword: "abcd1234" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("PASSWORD_POLICY_VIOLATION");
    expect(body.error.details.errors).toContain("密码必须包含大写字母");
  });

  it("当前密码错误 → 400 PASSWORD_CURRENT_INVALID，不写库", async () => {
    const res = await POST(makeRequest({ currentPassword: "wrong", newPassword: "Abcd1234" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("PASSWORD_CURRENT_INVALID");
    expect(userMock().update).not.toHaveBeenCalled();
  });

  it("新密码与当前密码相同 → 400 PASSWORD_SAME_AS_CURRENT", async () => {
    userMock().findUnique.mockResolvedValue({
      id: "u1",
      isActive: true,
      passwordHash: "hashed:Abcd1234",
      mustChangePassword: false,
    });
    const res = await POST(makeRequest({ currentPassword: "Abcd1234", newPassword: "Abcd1234" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("PASSWORD_SAME_AS_CURRENT");
    expect(userMock().update).not.toHaveBeenCalled();
  });

  it("合法改密 → 200：清零 mustChangePassword + 记录 passwordChangedAt + 写审计", async () => {
    const res = await POST(makeRequest({ currentPassword: "123456", newPassword: "Abcd1234" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.mustChangePassword).toBe(false);

    const updateArgs = userMock().update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "u1" });
    expect(updateArgs.data.mustChangePassword).toBe(false);
    expect(updateArgs.data.passwordHash).toBe("hashed:Abcd1234");
    expect(updateArgs.data.passwordChangedAt).toBeInstanceOf(Date);

    expect(authMocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.password.change", entityId: "u1" }),
    );
  });
});
