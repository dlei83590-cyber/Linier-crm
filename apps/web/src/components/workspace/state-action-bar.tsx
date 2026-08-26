'use client';

/**
 * StateActionBar — 状态动作栏（F2-1 UI System Foundation）
 *
 * 详情页操作区：展示当前状态徽章 + 按状态机解析后的动作按钮。
 * - 状态机规则由业务层解析（State_Action_Matrix 为准），本组件只渲染
 * - 声明了 confirm 的动作先弹 ConfirmActionDialog
 * - busy 动作显示进行中并禁用整栏，防止重复提交
 * - FE 2.0 UI 补齐：
 *   · sticky：长详情页滚动时动作栏吸顶（top-16 顶栏下方，backdrop 半透明）
 *   · disabled 动作原因：title 之外补 aria-describedby（读屏可达）
 */
import { useId, useState } from 'react';
import { StatusBadge } from './status-badge';
import { ConfirmActionDialog } from './confirm-action-dialog';
import type { StatusTone } from '@/components/design-system';
import { Spinner } from '@/components/ui/skeleton';

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
  /** 滚动吸顶（长详情页推荐开启） */
  sticky?: boolean;
}

const TONE_CLASS: Record<StateActionTone, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'border border-border bg-surface text-ink-primary hover:bg-surface-hover',
  danger: 'border border-status-danger-border bg-surface text-status-danger-text hover:bg-red-50',
};

export function StateActionBar({
  state,
  stateLabel,
  stateTone,
  actions,
  onAction,
  busyKey = null,
  sticky = false,
}: StateActionBarProps) {
  const [confirming, setConfirming] = useState<StateAction | null>(null);
  const reasonIdBase = useId();
  const busy = busyKey !== null;

  const handleClick = (action: StateAction) => {
    if (action.confirm) {
      setConfirming(action);
      return;
    }
    onAction(action.key);
  };

  const bar = (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={state} label={stateLabel} tone={stateTone} />
      {actions.map((action, i) => {
        const disabled = busy || action.disabled;
        const tone = action.tone ?? 'secondary';
        const reasonId = `${reasonIdBase}-reason-${i}`;
        return (
          <span key={action.key} className="inline-flex">
            <button
              type="button"
              onClick={() => handleClick(action)}
              disabled={disabled}
              title={action.disabled ? action.disabledReason : undefined}
              aria-describedby={action.disabled && action.disabledReason ? reasonId : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${TONE_CLASS[tone]}`}
            >
              {busyKey === action.key ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner />
                  处理中…
                </span>
              ) : (
                action.label
              )}
            </button>
            {action.disabled && action.disabledReason ? (
              <span id={reasonId} className="sr-only">
                {action.disabledReason}
              </span>
            ) : null}
          </span>
        );
      })}
      <ConfirmActionDialog
        open={confirming !== null}
        title={confirming?.confirm?.title ?? ''}
        description={confirming?.confirm?.description}
        confirmLabel={confirming?.confirm?.confirmLabel}
        busy={busy}
        onConfirm={() => {
          if (confirming) onAction(confirming.key);
          setConfirming(null);
        }}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );

  if (!sticky) return bar;

  return (
    <div className="bg-canvas/95 top-16 z-20 -mx-4 sticky px-4 py-2 backdrop-blur md:-mx-6 md:px-6">
      {bar}
    </div>
  );
}
