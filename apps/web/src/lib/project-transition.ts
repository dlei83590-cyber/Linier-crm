import type { ProjectStage } from '@prisma/client';

/**
 * Project 阶段流转唯一规则源（L2-B0：从 transition route 抽取为 backend shared module）。
 * 纪律：transition POST 与 aggregate GET 的 allowedTransitions 都消费本模块，
 * 不复制第二套规则；只返回 stage code，不返回中文 label。
 */

/** 正向推进顺序（CTO #3C5：只能前进，不能倒退/跳级） */
export const STAGE_ORDER: ProjectStage[] = [
  'LEAD',
  'QUALIFIED',
  'SOLUTION',
  'QUOTATION',
  'SAMPLING',
  'TESTING',
  'SMALL_BATCH',
  'MASS_SUPPLY',
];

/** 全部 ProjectStage code（read projection 候选集，与 Prisma enum 一致） */
export const PROJECT_STAGES: ProjectStage[] = [
  'LEAD',
  'QUALIFIED',
  'SOLUTION',
  'QUOTATION',
  'SAMPLING',
  'TESTING',
  'SMALL_BATCH',
  'MASS_SUPPLY',
  'PAUSED',
  'FAILED',
  'CLOSED',
];

/** 合法阶段流转判定（authoritative mutation 校验；含 from===to 内部兼容） */
export function isLegalTransition(from: ProjectStage, to: ProjectStage): boolean {
  if (from === to) return true;
  // 暂停/失败 → 结项 或 恢复
  if (from === 'PAUSED') {
    return to === 'FAILED' || to === 'CLOSED' || STAGE_ORDER.includes(to);
  }
  // 任意阶段 → 暂停/失败/结项（结项仅批量供货/失败/暂停后可）
  if (to === 'PAUSED' || to === 'FAILED') return true;
  if (to === 'CLOSED') {
    // PAUSED → CLOSED 已由上方 from === "PAUSED" 分支处理，此处无需重复比较
    return from === 'MASS_SUPPLY' || from === 'FAILED';
  }
  // 正向推进：只能前进，不能倒退/跳级
  const fromIdx = STAGE_ORDER.indexOf(from);
  const toIdx = STAGE_ORDER.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return false;
  return toIdx === fromIdx + 1;
}

/**
 * L2-B0：read projection 用「可操作候选」。
 * 基于 authoritative isLegalTransition 生成，显式排除 target===stage（自环）与 CLOSED——
 * isLegalTransition 的 from===to → true 是内部兼容逻辑，不暴露给 UI；
 * CLOSED 项目恒空（结项后禁止任何 stage mutation）。
 */
export function getAllowedProjectTransitions(stage: ProjectStage): ProjectStage[] {
  if (stage === 'CLOSED') return [];
  return PROJECT_STAGES.filter(
    (target) => target !== stage && target !== 'CLOSED' && isLegalTransition(stage, target),
  );
}
