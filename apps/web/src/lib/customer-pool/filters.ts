/**
 * 公海池列表筛选 → API 查询参数（UI-05 列表筛选统一）
 *
 * 与 GET /api/customer-pools 支持的过滤对齐：code / name / scopeType / isActive。
 * 纯函数 → 页面可单测；空值一律剔除（不把空串发给后端）。
 */
export interface PoolListFilterState {
  code?: string;
  name?: string;
  scopeType?: "" | "GLOBAL" | "REGION" | "DEPARTMENT";
  isActive?: "" | "true" | "false";
}

/** 筛选状态 → URL 查询参数（空值 → undefined，useListQuery 会跳过） */
export function buildPoolListParams(
  state: PoolListFilterState,
): Record<string, string | undefined> {
  return {
    code: state.code?.trim() || undefined,
    name: state.name?.trim() || undefined,
    scopeType: state.scopeType || undefined,
    isActive: state.isActive || undefined,
  };
}

/** 是否有任一生效筛选（供「重置」按钮可用态 / 空态文案判断） */
export function poolListHasFilter(state: PoolListFilterState): boolean {
  return (
    Boolean(state.code?.trim()) ||
    Boolean(state.name?.trim()) ||
    Boolean(state.scopeType) ||
    Boolean(state.isActive)
  );
}
