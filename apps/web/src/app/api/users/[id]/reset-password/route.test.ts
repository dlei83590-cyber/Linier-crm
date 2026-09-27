import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST /api/users/:id/reset-password — ADR-0059 管理员重置密码单测
 * 覆盖：权限拒绝 / 用户不存在 404 / 已停用 409 / 成功 → 回到初始密码 123456 + mustChangePassword=true + 审计。
 * 验证事实源 = GitHub CI（本地不运行测试）。
 */

const { mockPrisma, helpers } = vi.hoisted(() => ({
  mockPrisma: {} as Record<string, unknown>,
  helpers: {
    authenticate: vi.fn(),
    requirePermission: vi.fn(),
    writeAuditLog: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/api-helpers", () => ({
  authenticate: helpers.authenticate,
  requirePermission: helpers.requirePermission,
  requestMeta: vi.fn().mockReturnValue({ requestId: "req-1" }),
  writeAuditLog: helpers.writeAuditLog,
}));
vi.mock("@/lib/api/logger", () => ({ requestLog: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  hashPassword: vi.fn(async (plain: string) => `hashed:${plain}`),
}));

import { POST } from "@/app/api/users/[id]/reset-password/route";

interface UserMock {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function userMock(): UserMock {
  return mockPrisma.user as UserMock;
}

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/users/u-2/reset-password", {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
  });
}

const params = Promise.resolve({ id: "u-2" });

describe("POST /api/users/:id/reset-password（ADR-0059）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user = { findUnique: vi.fn(), update: vi.fn() };
    helpers.authenticate.mockResolvedValue({
      id: "admin-1",
      email: "admin@b.c",
      name: "Admin",
      roles: ["ADMIN"],
      permissions: ["user:edit"],
      mustChangePassword: false,
      passwordChangedAt: null,
    });
    helpers.requirePermission.mockReturnValue(null);
    helpers.writeAuditLog.mockResolvedValue(undefined);
    userMock().findUnique.mockResolvedValue({
      id: "u-2",
      email: "user@b.c",
      isActive: true,
      mustChangePassword: false,
    });
    userMock().update.mockResolvedValue({ id: "u-2" });
  });

  it("无 user:edit 权限 → 直接返回 requirePermission 的拒绝响应（不触库）", async () => {
    const denied = new Response(null, { status: 403 });
    helpers.requirePermission.mockReturnValue(denied);
    const res = await POST(makeRequest(), { params });
    expect(res).toBe(denied);
    expect(userMock().findUnique).not.toHaveBeenCalled();
  });

  it("用户不存在 → 404", async () => {
    userMock().findUnique.mockResolvedValue(null);
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(404);
    expect(userMock().update).not.toHaveBeenCalled();
  });

  it("用户已停用 → 409（不重置，避免产生不可登录的凭据）", async () => {
    userMock().findUnique.mockResolvedValue({
      id: "u-2",
      email: "user@b.c",
      isActive: false,
      mustChangePassword: false,
    });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(409);
    expect(userMock().update).not.toHaveBeenCalled();
  });

  it("成功 → 密码回到初始密码 123456 + mustChangePassword=true（强制下次登录改密）", async () => {
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.mustChangePassword).toBe(true);

    const updateArgs = userMock().update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "u-2" });
    // 固定初始密码（不接受任何自定义密码）
    expect(updateArgs.data.passwordHash).toBe("hashed:123456");
    expect(updateArgs.data.mustChangePassword).toBe(true);
    expect(updateArgs.data.passwordChangedAt).toBeInstanceOf(Date);

    expect(helpers.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.password.reset", entityId: "u-2" }),
    );
  });
});
