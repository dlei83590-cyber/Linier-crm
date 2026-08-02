import { describe, expect, it } from "vitest";
import { openapi } from "@/src/lib/openapi";

describe("OpenAPI document", () => {
  it("describes the infrastructure endpoints and bearer authentication", () => {
    expect(openapi.openapi).toBe("3.1.0");
    expect(openapi.paths).toHaveProperty("/health");
    expect(openapi.paths).toHaveProperty("/system/protected");
    expect(openapi.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
    });
  });
});
