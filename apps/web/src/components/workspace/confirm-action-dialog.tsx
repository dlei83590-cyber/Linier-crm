'use client';

/**
 * ConfirmActionDialog — 动作确认对话框（F2-1 UI System Foundation / FE 2.0 UI-01 升级）
 *
 * 破坏性/不可逆动作（取消、过账、删除等）的二次确认。
 * UI-01：委托 components/ui/confirm-dialog（Dialog 底座：ESC/遮罩/focus trap/scroll lock）；
 * Props 签名完全向后兼容（StateActionBar 等存量消费方零改动）。
 */
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export interface ConfirmActionDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmActionDialog(props: ConfirmActionDialogProps) {
  return <ConfirmDialog {...props} />;
}
