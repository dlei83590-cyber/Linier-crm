/**
 * ConfirmDialog — 动作确认对话框（FE 2.0 UI-01，构建于 Dialog 之上）
 *
 * 破坏性/不可逆动作（取消、过账、删除等）的二次确认。
 * - ESC / 遮罩关闭（遮罩点击关闭默认开启，与旧 ConfirmActionDialog 行为一致）
 * - busy 期间确认/取消禁用
 * 替代 window.confirm / window.prompt（红线：禁止新增原生弹窗）。
 */
'use client';

import { Button } from './button';
import { Dialog } from './dialog';

export type ConfirmDialogTone = 'primary' | 'danger';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      busy={busy}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="md"
            onClick={onConfirm}
            loading={busy}
          >
            {busy ? '处理中…' : confirmLabel}
          </Button>
        </>
      }
    >
      {null}
    </Dialog>
  );
}
