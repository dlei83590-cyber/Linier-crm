import { describe, it, expect } from "vitest";
import { ERROR_CODES } from "@/lib/api/errors";
import { parsePagination } from "@/lib/api/response";

describe("api errors - 错误码常量", () => {
  it("包含核心与 Workflow 错误码", () => {
    expect(ERROR_CODES.VALIDATION_ERROR).toBe("VALIDATION_ERROR");
    expect(ERROR_CODES.WORKFLOW_DEFINITION_NOT_FOUND).toBe("WORKFLOW_DEFINITION_NOT_FOUND");
    expect(ERROR_CODES.WORKFLOW_INSTANCE_EXISTS).toBe("WORKFLOW_INSTANCE_EXISTS");
    expect(ERROR_CODES.VERSION_CONFLICT).toBe("VERSION_CONFLICT");
    expect(ERROR_CODES.NOTIFICATION_TEMPLATE_CODE_EXISTS).toBe("NOTIFICATION_TEMPLATE_CODE_EXISTS");
  });

  it("错误码无重复值", () => {
    const values = Object.values(ERROR_CODES);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("api response - parsePagination", () => {
  it("默认值 page=1 pageSize=20", () => {
    const p = parsePagination(new URLSearchParams());
    expect(p).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
  });

  it("自定义分页", () => {
    const p = parsePagination(new URLSearchParams({ page: "3", pageSize: "10" }));
    expect(p).toEqual({ page: 3, pageSize: 10, skip: 20, take: 10 });
  });

  it("pageSize 上限 100", () => {
    const p = parsePagination(new URLSearchParams({ pageSize: "500" }));
    expect(p.pageSize).toBe(100);
  });

  it("非法输入回退默认值", () => {
    const p = parsePagination(new URLSearchParams({ page: "abc", pageSize: "-5" }));
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(20);
  });
});
