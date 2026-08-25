/**
 * App Shell 纯函数（UI-02 Frontend Experience 2.0）
 *
 * AdminShell 侧栏/顶栏/快捷创建/命令面板的派生逻辑全部收敛到这里，保持组件
 * 只做渲染与交互；所有导航事实仍只消费 Module Registry（lib/frontend/modules.ts，
 * SSOT 只读）。本文件不依赖 React / DOM，可直接单测。
 */

import { hasPermission, type RoleCode } from "@nilier-crm/shared";
import {
  modulesByDomainGrouped,
  type DomainModuleGroup,
  type FrontendModule,
  type ModuleDomainDef,
} from "./modules";

/** 侧栏折叠偏好 localStorage 键（唯一来源） */
export const SIDEBAR_STORAGE_KEY = "linier.sidebar.collapsed";

/** 解析折叠偏好存储值："1" = 折叠；其它值 / 缺失 = 展开（fail-safe 展开） */
export function parseCollapsedPreference(raw: string | null): boolean {
  return raw === "1";
}

/**
 * 权限过滤后的可见域分组（Registry 投影，唯一事实源）。
 * 规则：模块 permission 为 null（所有登录用户可见）或角色持有该权限才可见；
 * 过滤后为空的一级域整组隐藏。
 */
export function filterVisibleGroups(roles: RoleCode[]): DomainModuleGroup[] {
  const groups = modulesByDomainGrouped();
  const visible = (ms: FrontendModule[]) =>
    ms.filter((m) => m.permission === null || hasPermission(roles, m.permission));
  return groups
    .map((g) => ({
      domain: g.domain,
      ready: visible(g.ready),
      preview: visible(g.preview),
      hold: visible(g.hold),
    }))
    .filter((g) => g.ready.length > 0 || g.preview.length > 0 || g.hold.length > 0);
}

export interface CurrentModuleHit {
  module: FrontendModule;
  domainId: string;
}

/** 当前模块（仅 ready/preview；pathname 精确匹配或前缀匹配详情/子路由） */
export function resolveCurrentModule(
  pathname: string,
  groups: DomainModuleGroup[],
): CurrentModuleHit | null {
  const hit = groups
    .flatMap((g) => [
      ...g.ready.map((m) => ({ module: m, domainId: g.domain.id })),
      ...g.preview.map((m) => ({ module: m, domainId: g.domain.id })),
    ])
    .find(({ module }) => pathname === module.route || pathname.startsWith(`${module.route}/`));
  return hit ?? null;
}

/**
 * 当前业务域：按 pathname 前缀匹配；未命中时回退到第一个非空域（保持侧栏当前域展开）。
 */
export function resolveCurrentDomain(
  pathname: string,
  groups: DomainModuleGroup[],
): ModuleDomainDef | null {
  const matched = groups
    .flatMap((g) => [...g.ready, ...g.preview, ...g.hold])
    .find((m) => pathname === m.route || pathname.startsWith(`${m.route}/`));
  if (matched) return matched.domain;
  return groups[0]?.domain ?? null;
}

export interface QuickCreateItem {
  module: FrontendModule;
  domainId: string;
}

/**
 * 快捷创建投影（Header Quick Create 消费）。
 * 只允许真实入口：ready 模块 + ui.create=true + Registry 权威 createRoute/createPermission
 * （禁止用 route + '/new' 推导），并做 createPermission 权限过滤。
 */
export function quickCreateItems(
  roles: RoleCode[],
  groups: DomainModuleGroup[],
): QuickCreateItem[] {
  return groups.flatMap((g) =>
    g.ready
      .filter(
        (m) =>
          m.capabilities.ui.create &&
          m.createRoute != null &&
          m.createPermission != null &&
          hasPermission(roles, m.createPermission),
      )
      .map((m) => ({ module: m, domainId: g.domain.id })),
  );
}
