'use client';

/**
 * StatusBadge — 统一状态徽章（F2-1 UI System Foundation）
 *
 * - 内部 key 保留真实 enum，禁止跨状态语义压缩（如 APPROVED→"完成"）
 * - 展示文案可中文化（label），但 status key 必须原样
 * - tone 优先级：显式 tone > 模块级 toneMap > 默认映射 > neutral
 * - 存量页面继续使用 components/ui/status-badge（迁移期不推倒重写）
 */
import { STATUS_COLORS, type StatusTone } from '@/components/design-system';

/** 默认映射：通用工作流状态 → 语义色（模块级映射在业务层 toneMap 扩展） */
const DEFAULT_TONE_MAP: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  PENDING: 'info',
  SUBMITTED: 'info',
  CONVERTED: 'info',
  APPROVED: 'success',
  CONFIRMED: 'success',
  POSTED: 'success',
  COMPLETED: 'success',
  EXECUTED: 'success',
  APPLIED: 'success',
  QUALIFIED: 'success',
  PARTIALLY_RECEIVED: 'warning',
  PARTIAL: 'warning',
  RETURNED: 'warning',
  COUNTING: 'info',
  REJECTED: 'danger',
  CANCELLED: 'danger',
};

interface StatusBadgeProps {
  status: string;
  /** 显示文案；缺省用 status 原文 */
  label?: string;
  /** 显式 tone（优先） */
  tone?: StatusTone;
  /** 模块级状态→tone 映射扩展 */
  toneMap?: Record<string, StatusTone>;
}

export function StatusBadge({ status, label, tone, toneMap }: StatusBadgeProps) {
  const resolved: StatusTone = tone ?? toneMap?.[status] ?? DEFAULT_TONE_MAP[status] ?? 'neutral';
  const c = STATUS_COLORS[resolved];
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}
    >
      {label ?? status}
    </span>
  );
}
