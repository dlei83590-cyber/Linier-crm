/**
 * 报销驳回原因校验（FE2.0 UI-10）
 *
 * window.prompt 替换为 ReasonDialog 后，本函数是驳回原因的唯一前端校验事实，
 * 与 POST /api/expenses/:id/reject 的 zod 契约对齐（reason: 1..500，trim 后非空）。
 * 保持纯函数以便单测与组件复用。
 */
export const REJECT_REASON_MAX_LENGTH = 500;

export function validateRejectReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return "驳回必须提供原因";
  if (trimmed.length > REJECT_REASON_MAX_LENGTH) {
    return `驳回原因不能超过 ${REJECT_REASON_MAX_LENGTH} 字`;
  }
  return null;
}
