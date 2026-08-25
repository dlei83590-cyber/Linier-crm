import { describe, expect, it } from "vitest";
import type { RoleCode } from "@nilier-crm/shared";
import {
  filterVisibleGroups,
  parseCollapsedPreference,
  quickCreateItems,
  resolveCurrentDomain,
  resolveCurrentModule,
} from "./shell";

/**
 * App Shell 纯函数测试（UI-02 Frontend Experience 2.0）
 *
 * 覆盖：侧栏折叠偏好解析、权限过滤投影、当前模块/域解析、快捷创建投影
 * （Registry ui.create + createRoute + createPermission 权威入口 + 权限门）。
 */

const ADMIN: RoleCode[] = ["ADMIN"];
const VIEWER: RoleCode[] = ["VIEWER"];

describe("App Shell 纯函数（UI-02）", () => {
  describe("parseCollapsedPreference（折叠状态）", () => {
    it('仅 "1" 视为折叠；缺失/其它值安全回退展开', () => {
      expect(parseCollapsedPreference("1")).toBe(true);
      expect(parseCollapsedPreference("0")).toBe(false);
      expect(parseCollapsedPreference(null)).toBe(false);
      expect(parseCollapsedPreference("yes")).toBe(false);
      expect(parseCollapsedPreference("")).toBe(false);
    });
  });

  describe("filterVisibleGroups（权限过滤投影）", () => {
    it("无权限角色只保留 permission=null 的模块，空域整组隐藏", () => {
      const groups = filterVisibleGroups(VIEWER);
      const workbench = groups.find((g) => g.domain.id === "workbench");
      expect(workbench?.ready.map((m) => m.id)).toEqual(["dashboard"]);
      expect(groups.find((g) => g.domain.id === "master-data")).toBeUndefined();
      expect(groups.find((g) => g.domain.id === "sales")).toBeUndefined();
      expect(groups.find((g) => g.domain.id === "purchasing")).toBeUndefined();
    });

    it("ADMIN 可见权限域；任何可见模块的 permission 均被角色持有", () => {
      const groups = filterVisibleGroups(ADMIN);
      const sales = groups.find((g) => g.domain.id === "sales");
      expect(sales?.ready.map((m) => m.id)).toContain("quotations");
      expect(sales?.ready.map((m) => m.id)).toContain("sales-orders");
      const masterData = groups.find((g) => g.domain.id === "master-data");
      expect(masterData?.ready.length).toBeGreaterThan(0);
      expect(masterData?.ready.map((m) => m.id)).toContain("items");
    });
  });

  describe("resolveCurrentModule / resolveCurrentDomain（当前模块/域）", () => {
    const groups = filterVisibleGroups(ADMIN);

    it("精确路由命中模块与域", () => {
      const hit = resolveCurrentModule("/sales/quotations", groups);
      expect(hit?.module.id).toBe("quotations");
      expect(hit?.domainId).toBe("sales");
      expect(resolveCurrentDomain("/sales/quotations", groups)?.id).toBe("sales");
    });

    it("详情/子路由按前缀命中模块", () => {
      const hit = resolveCurrentModule("/projects/abc-123", groups);
      expect(hit?.module.id).toBe("projects");
      expect(hit?.domainId).toBe("customer-project");
    });

    it("未命中：当前模块为 null，当前域回退第一个非空域", () => {
      expect(resolveCurrentModule("/no-such-page", groups)).toBeNull();
      expect(resolveCurrentDomain("/no-such-page", groups)?.id).toBe("workbench");
    });
  });

  describe("quickCreateItems（快捷创建投影）", () => {
    it("ADMIN：只含 ui.create + 权威 createRoute/createPermission 的 ready 模块", () => {
      const items = quickCreateItems(ADMIN, filterVisibleGroups(ADMIN));
      const ids = items.map((i) => i.module.id);
      expect(ids.length).toBeGreaterThan(10);
      expect(ids).toContain("quotations");
      expect(ids).toContain("items");
      expect(ids).toContain("purchase-orders");
      // 无直接 create 的模块（创建走上游单据链）不得出现假入口
      expect(ids).not.toContain("sales-orders");
      expect(ids).not.toContain("deliveries");
      expect(ids).not.toContain("sales-invoices");
      // 每条投影都携带权威入口元数据
      for (const item of items) {
        expect(item.module.capabilities.ui.create).toBe(true);
        expect(item.module.createRoute).toBeTruthy();
        expect(item.module.createPermission).toBeTruthy();
      }
    });

    it("VIEWER：无 create 权限 → 空投影（不渲染假按钮）", () => {
      expect(quickCreateItems(VIEWER, filterVisibleGroups(VIEWER))).toEqual([]);
    });
  });
});
