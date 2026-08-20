import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { assertProjectWritable, authenticate } from "@/lib/api-helpers";

const authMocks = vi.hoisted(() => ({
  verifySessionToken: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  verifySessionToken: authMocks.verifySessionToken,
  SESSION_COOKIE_NAME: "linier_session",
}));

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

/**
 * Project Lifecycle 契约单测（CTO P2 G-1）：assertProjectWritable — CLOSED 写门禁（B2-0/L1-A）
 * 覆盖：项目不存在（404）/ CLOSED fail-closed（409）/ 可写（ok:true 带 locked project）。
 * 锁序：Project header FOR UPDATE → Gate → mutation（事务内调用方职责）。
 * 验证事实源 = GitHub CI（本地不运行测试）。
 */

function makeTx(rows: unknown[]) {
  return { $queryRaw: vi.fn().mockResolvedValue(rows) } as unknown as Prisma.TransactionClient;
}

describe("assertProjectWritable — CLOSED 写门禁", () => {
  it("项目不存在（FOR UPDATE 无行）→ 409（failConflict 固定 409；body code=NOT_FOUND 供客户端识别）", async () => {
    const tx = makeTx([]);
    const r = await assertProjectWritable(tx, "p-x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(409);
  });

  it("stage === CLOSED → 409 fail-closed（结项后禁止子资源写）", async () => {
    const tx = makeTx([{ id: "p1", stage: "CLOSED", version: 3, paymentStatus: "UNPAID", receivableBalance: null }]);
    const r = await assertProjectWritable(tx, "p1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(409);
  });

  it("非 CLOSED → ok:true 携带 locked project（锁后权威版本）", async () => {
    const tx = makeTx([{ id: "p1", stage: "MASS_SUPPLY", version: 7, paymentStatus: "PARTIALLY_PAID", receivableBalance: null }]);
    const r = await assertProjectWritable(tx, "p1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.id).toBe("p1");
    expect(r.project.stage).toBe("MASS_SUPPLY");
    expect(r.project.version).toBe(7);
    expect(tx.$queryRaw).toHaveBeenCalled();
  });
});
describe("authenticate — ADR-0045 双来源认证（Bearer → httpOnly cookie 回退）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.verifySessionToken.mockResolvedValue({ sub: "u1", email: "a@b.c", roles: ["SUPER_ADMIN"] });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.c",
      name: "Admin",
      isActive: true,
      roles: [{ role: { code: "SUPER_ADMIN" } }],
    });
  });

  it("Bearer 请求 → 返回用户（API 客户端/遗留路径）", async () => {
    const req = new NextRequest("http://localhost/api/auth/me", {
      headers: { authorization: "Bearer tok" },
    });
    const u = await authenticate(req);
    expect(u).not.toBeNull();
    expect(u?.email).toBe("a@b.c");
    expect(u?.name).toBe("Admin");
    expect(authMocks.verifySessionToken).toHaveBeenCalledWith("tok");
  });

  it("仅 cookie（无 Bearer）→ 返回用户（登录后 SessionProvider.refresh 场景，修复卡登录页）", async () => {
    const req = new NextRequest("http://localhost/api/auth/me", {
      headers: { cookie: "linier_session=cookie-tok" },
    });
    const u = await authenticate(req);
    expect(u).not.toBeNull();
    expect(u?.email).toBe("a@b.c");
    expect(authMocks.verifySessionToken).toHaveBeenCalledWith("cookie-tok");
  });

  it("无任何凭据 → null（不调用 verifySessionToken）", async () => {
    const req = new NextRequest("http://localhost/api/auth/me");
    expect(await authenticate(req)).toBeNull();
    expect(authMocks.verifySessionToken).not.toHaveBeenCalled();
  });

  it("token 校验失败（过期/篡改）→ null", async () => {
    authMocks.verifySessionToken.mockRejectedValue(new Error("bad token"));
    const req = new NextRequest("http://localhost/api/auth/me", {
      headers: { cookie: "linier_session=bad" },
    });
    expect(await authenticate(req)).toBeNull();
  });

  it("用户不存在或停用 → null", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/auth/me", {
      headers: { cookie: "linier_session=tok" },
    });
    expect(await authenticate(req)).toBeNull();
  });
});
