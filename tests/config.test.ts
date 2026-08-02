import { describe, expect, it } from "vitest";
import { getEnvironment } from "@/src/config/env";

const valid = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  JWT_SECRET: "test-secret-that-is-at-least-32-characters",
};

describe("environment configuration", () => {
  it("loads defaults after validating required values", () => {
    expect(getEnvironment(valid)).toMatchObject({
      NODE_ENV: "test",
      PORT: 3000,
      LOG_LEVEL: "info",
      JWT_ISSUER: "linier-crm",
      JWT_AUDIENCE: "linier-crm-web",
      JWT_EXPIRES_IN: "15m",
    });
  });

  it("rejects missing secrets and invalid token durations", () => {
    expect(() => getEnvironment({ ...valid, JWT_SECRET: "short" })).toThrow(
      "Invalid environment configuration",
    );
    expect(() =>
      getEnvironment({ ...valid, JWT_EXPIRES_IN: "forever" }),
    ).toThrow("Invalid environment configuration");
  });
});
