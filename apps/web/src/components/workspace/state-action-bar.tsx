'use client';

/**
 * StateActionBar — 状态动作栏（F2-1 UI System Foundation）
 *
 * 详情页操作区：展示当前状态徽章 + 按状态机解析后的动作按钮。
 * - 状态机规则由业务层解析（State_Action_Matrix 为准），本组件只渲染
 * - 声明了 confirm 的动作先弹 ConfirmActionDialog
 * - busy 动作显示进行中并禁用整栏，防止重复提交
 */
import { useState } from 'react';
import { StatusBadge } from './status-badge';
import { ConfirmActionDialog } from './confirm-action-dialog';
import type { StatusTone } from '@/components/design-system';

export type StateActionTone = 'primary' | 'secondary' | 'danger';

export interface StateAction {
  key: string;
  label: string;
  tone?: StateActionTone;
  /** 需要二次确认的动作（破坏性/不可逆） */
  confirm?: {
    title: string;
    description?: string;
    confirmLabel?: string;
  };
  disabled?: boolean;
  disabledReason?: string;
}

interface StateActionBarProps {
  /** 当前状态（内部 key 保留真实 enum） */
  state: string;
  stateLabel?: string;
  stateTone?: StatusTone;
  actions: StateAction[];
  onAction: (key: string) => void;
  /** 当前执行中的动作 key（执行中整栏禁用） */
  busyKey?: string | null;
}

const TONE_CLASS: Record<StateActionTone, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'border border-border bg-surface text-ink-primary hover:bg-slate-50',
  danger: 'border border-status-danger-border bg-surface text-status-danger-text hover:bg-red-50',
};

export function StateActionBar({
  state,
  stateLabel,
  stateTone,
  actions,
  onAction,
  busyKey = null,
}: StateActionBarProps) {
  const [confirming, setConfirming] = useState<StateAction | null>(null);
  const busy = busyKey !== null;

  const handleClick = (action: StateAction) => {
    if (action.confirm) {
      setConfirming(action);
      return;
    }
    onAction(action.key);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={state} label={stateLabel} tone={stateTone} />
      {actions.map((action) => {
        const disabled = busy || action.disabled;
        const tone = action.tone ?? 'secondary';
        return (
          <button
            key={action.key}
            type="button"
            onClick={() => handleClick(action)}
            disabled={disabled}
            title={action.disabled ? action.disabledReason : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${TONE_CLASS[tone]}`}
          >
            {busyKey === action.key ? '处理中…' : action.label}
          </button>
        );
      })}
      <ConfirmActionDialog
        open={confirming !== null}
        title={confirming?.confirm?.title ?? ''}
        description={confirming?.confirm?.description}
        confirmLabel={confirming?.confirm?.confirmLabel}
        tone={confirming?.tone === 'danger' ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={() => {
          const key = confirming?.key;
          setConfirming(null);
          if (key) onAction(key);
        }}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
