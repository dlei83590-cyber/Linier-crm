/**
 * 模块页仪表盘 KPI 契约（Module Summary）
 *
 * 每个业务单据模块列表页顶部展示「该页面的仪表盘」——KPI 数字卡片条：
 * 全部 + 按状态计数（点击联动列表筛选）+ 头级金额汇总（展示）。
 *
 * 数据源 = GET /api/<module>/summary（只读聚合，同一 Prisma 模型 + 同一状态枚举，
 * 不建立平行业务真相；金额一律 Decimal 字符串返回，禁止 toNumber）。
 */

export interface ModuleSummaryAmount {
  label: string;
  /** Decimal 字符串（服务端 canonical；禁止 toNumber） */
  value: string;
}

export interface ModuleSummaryData {
  /** 未删除单据总数 */
  total: number;
  /** 按状态计数（key = 状态枚举值，如 DRAFT/SUBMITTED/...） */
  byStatus: Record<string, number>;
  /** 头级金额汇总（可选；仅单据头含金额字段的模块返回） */
  amount?: ModuleSummaryAmount;
}

/** KPI 卡片定义（顺序即展示顺序，与页面状态筛选下拉一致） */
export interface ModuleKpiStatusDef {
  /** 状态枚举值（真实 enum key） */
  value: string;
  /** 中文业务名（Business UX Rationalization：展示中文，不展示枚举值） */
  label: string;
}
