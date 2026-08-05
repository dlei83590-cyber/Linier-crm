import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { requestMeta } from "@/lib/api-helpers";

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  const req = new NextRequest(new URL("http://localhost/api/test"));
  for (const [k, v] of Object.entries(headers)) {
    req.headers.set(k, v);
  }
  return req;
}

describe("requestMeta - Sprint 3B Audit 升级", () => {
  it("无头时返回默认值（device=desktop, browser=null）", () => {
    const meta = requestMeta(makeRequest());
    expect(meta.requestId).toBeNull();
    expect(meta.traceId).toBeNull();
    expect(meta.device).toBe("desktop");
    expect(meta.browser).toBeNull();
    expect(meta.ipAddress).toBeUndefined();
  });

  it("透传 x-request-id / x-trace-id", () => {
    const meta = requestMeta(
      makeRequest({ "x-request-id": "req-123", "x-trace-id": "trace-abc" }),
    );
    expect(meta.requestId).toBe("req-123");
    expect(meta.traceId).toBe("trace-abc");
  });

  it("移动端 UA → device=mobile，Chrome 识别", () => {
    const meta = requestMeta(
      makeRequest({ "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36" }),
    );
    expect(meta.device).toBe("mobile");
    expect(meta.browser).toBe("Chrome");
  });

  it("桌面 Chrome 识别", () => {
    const meta = requestMeta(
      makeRequest({ "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" }),
    );
    expect(meta.device).toBe("desktop");
    expect(meta.browser).toBe("Chrome");
  });

  it("Firefox 识别", () => {
    const meta = requestMeta(
      makeRequest({ "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0" }),
    );
    expect(meta.browser).toBe("Firefox");
  });

  it("IP 优先 x-forwarded-for 首段", () => {
    const meta = requestMeta(
      makeRequest({ "x-forwarded-for": "203.0.113.5, 70.41.3.18" }),
    );
    expect(meta.ipAddress).toBe("203.0.113.5");
  });

  it("x-real-ip 兜底", () => {
    const meta = requestMeta(makeRequest({ "x-real-ip": "198.51.100.7" }));
    expect(meta.ipAddress).toBe("198.51.100.7");
  });
});
