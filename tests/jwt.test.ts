import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters";
  process.env.JWT_ISSUER = "linier-crm-test";
  process.env.JWT_AUDIENCE = "linier-crm-test-client";
  process.env.JWT_EXPIRES_IN = "15m";
});

describe("JWT framework", () => {
  it("signs and verifies a valid principal", async () => {
    const { Permission } = await import("@/src/lib/auth/rbac");
    const { signAccessToken, verifyAccessToken } =
      await import("@/src/lib/auth/jwt");
    const token = await signAccessToken({
      subject: "test-user",
      roles: ["reader"],
      permissions: [Permission.SYSTEM_READ],
    });
    await expect(verifyAccessToken(token)).resolves.toMatchObject({
      subject: "test-user",
      roles: ["reader"],
    });
  });

  it("rejects an invalid token", async () => {
    const { verifyAccessToken } = await import("@/src/lib/auth/jwt");
    await expect(verifyAccessToken("invalid")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
  });
});
