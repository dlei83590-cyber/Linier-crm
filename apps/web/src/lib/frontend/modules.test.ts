import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MODULES } from "./modules";

/**
 * Frontend Module Registry 一致性测试（FRT-01 — Registry / Navigation SSOT）
 *
 * 防止 Registry 与实际页面 surface 再次漂移：
 * 1. ready 模块 route 必须存在真实列表页（page.tsx）
 * 2. ui.create=true 必须带权威 createRoute + createPermission，且 createRoute 页面存在
 * 3. ui.detail=true 必须存在 [id] 详情页
 * 4. ui 层能力不得大于 contract 层（ui ⊆ contract；禁止虚报已开放能力）
 * 5. ready 模块 id / route 唯一
 */
const APP_DIR = join(process.cwd(), "src/app/(dashboard)");

const readyModules = MODULES.filter((m) => m.availability === "ready");

function pageExists(route: string): boolean {
  return existsSync(join(APP_DIR, route.replace(/^\//, ""), "page.tsx"));
}

describe("Frontend Module Registry 一致性", () => {
  it("ready 模块 route 必须存在真实列表页（page.tsx）", () => {
    const missing = readyModules.filter((m) => !pageExists(m.route));
    expect(missing.map((m) => m.id)).toEqual([]);
  });

  it("ui.create=true 的 ready 模块必须带权威 createRoute/createPermission 且页面存在", () => {
    const bad = readyModules.filter(
      (m) => m.capabilities.ui.create && (!m.createRoute || !m.createPermission || !pageExists(m.createRoute)),
    );
    expect(bad.map((m) => m.id)).toEqual([]);
  });

  it("ui.detail=true 的 ready 模块必须存在 [id] 详情页", () => {
    const bad = readyModules.filter(
      (m) => m.capabilities.ui.detail && !pageExists(m.route + "/[id]"),
    );
    expect(bad.map((m) => m.id)).toEqual([]);
  });

  it("ui 层能力不得大于 contract 层（ui ⊆ contract）", () => {
    const caps = ["list", "detail", "create", "edit", "workflow", "factActions"] as const;
    const bad = readyModules.filter((m) =>
      caps.some((k) => m.capabilities.ui[k] && !m.capabilities.contract[k]),
    );
    expect(bad.map((m) => m.id)).toEqual([]);
  });

  it("ready 模块 id / route 唯一", () => {
    const ids = readyModules.map((m) => m.id);
    const routes = readyModules.map((m) => m.route);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
