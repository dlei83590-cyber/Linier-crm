/**
 * UI 组件统一出口（FE 2.0 UI-01）
 *
 * 新增代码优先从本出口导入；既有深路径导入（@/components/ui/xxx）继续有效，不破坏存量。
 */
// ---- 基元：图标 / 按钮 ----
export { Icon, ICON_NAMES } from './icon';
export type { IconName, IconProps } from './icon';
export { Button } from './button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './button';
export { IconButton } from './icon-button';
export type { IconButtonProps, IconButtonVariant, IconButtonSize } from './icon-button';

// ---- 展示：徽章 / 卡片 / 标题 ----
export { Badge } from './badge';
export type { BadgeProps, BadgeTone, BadgeSize } from './badge';
export { Card, CardHeader, CardContent, CardFooter } from './card';
export type { CardProps, CardHeaderProps, CardContentProps, CardFooterProps, CardPadding } from './card';
export { SectionHeader } from './section-header';
export type { SectionHeaderProps } from './section-header';

// ---- 表单 ----
export { FormField } from './form-field';
export type { FormFieldProps } from './form-field';
export { Input } from './input';
export type { InputProps, InputSize } from './input';
export { Select } from './select';
export type { SelectProps, SelectSize } from './select';
export { Combobox } from './combobox';
export type { ComboboxProps, ComboboxOption } from './combobox';

// ---- 浮层：对话框 / 抽屉 ----
export { Dialog } from './dialog';
export type { DialogProps, DialogSize } from './dialog';
export { ConfirmDialog } from './confirm-dialog';
export type { ConfirmDialogProps, ConfirmDialogTone } from './confirm-dialog';
export { Drawer } from './drawer';
export type { DrawerProps, DrawerSide, DrawerSize } from './drawer';

// ---- 反馈：空态 / 错误 / 骨架 / Toast ----
export { EmptyState } from './empty-state';
export type { EmptyStateProps } from './empty-state';
export { ErrorState } from './error-state';
export type { ErrorStateProps } from './error-state';
export { Skeleton, SkeletonText, SkeletonCircle, SkeletonButton, PageLoading, Spinner } from './skeleton';
export { ToastProvider, useToast } from './toast';
export type { ToastVariant, ToastContextValue } from './toast';

// ---- 导航 / 结构：Tabs / Dropdown / Breadcrumb / KPI / Timeline ----
export { Tabs } from './tabs';
export type { TabsProps, TabItem, TabsVariant, TabsSize } from './tabs';
export { Dropdown } from './dropdown';
export type { DropdownProps, DropdownItem, DropdownEntry, DropdownSeparator } from './dropdown';
export { Breadcrumb } from './breadcrumb';
export type { BreadcrumbProps, BreadcrumbItem } from './breadcrumb';
export { KpiCard } from './kpi-card';
export type { KpiCardProps } from './kpi-card';
export { Timeline } from './timeline';
export type { TimelineProps, TimelineItem } from './timeline';

// ---- 存量（签名不变，继续导出）----
export { AnimatedNumber, AnimatedMoney } from './animated-number';
export { Forbidden } from './forbidden';
export { LoadingRow, EmptyRow, ErrorRow } from './list-states';
export { Pagination } from './pagination';
export { PlaceholderPage } from './placeholder-page';
export { StatusBadge as UiStatusBadge } from './status-badge';
