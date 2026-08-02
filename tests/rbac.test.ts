import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/src/lib/http/errors";
import {
  Permission,
  hasPermission,
  requirePermission,
  type Principal,
} from "@/src/lib/auth/rbac";

const reader: Principal = {
  subject: "test-user",
  roles: ["reader"],
  permissions: [Permission.SYSTEM_READ],
};

describe("RBAC framework", () => {
  it("allows an assigned permission", () =>
    expect(hasPermission(reader, Permission.SYSTEM_READ)).toBe(true));
  it("rejects a missing permission", () =>
    expect(() => requirePermission(reader, Permission.SYSTEM_ADMIN)).toThrow(
      ForbiddenError,
    ));
});
