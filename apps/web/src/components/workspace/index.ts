/**
 * Workspace Primitives — 统一出口（F2-1 UI System Foundation）
 *
 * 业务页面只从这里导入工作区原语，禁止绕过统一层自造布局。
 * 每个 primitive 的职责见 docs/frontend/Workspace_Primitives.md。
 */
export { AppPage } from './app-page';
export type { AppPageMaxWidth } from './app-page';

export { PageHeader } from './page-header';
export { PageToolbar } from './page-toolbar';

export { EntityListWorkspace } from './entity-list-workspace';
export type { ListColumn } from './entity-list-workspace';

export { EntityDetailWorkspace } from './entity-detail-workspace';
export { EntityFormWorkspace } from './entity-form-workspace';

export { ReferenceSelector } from './reference-selector';
export type { ReferenceOption } from './reference-selector';

export { DependentSelector } from './dependent-selector';
export type { DependentLevel } from './dependent-selector';

export { LineEditor } from './line-editor';
export type { LineColumn, LineRow } from './line-editor';

export { StatusBadge } from './status-badge';

export { StateActionBar } from './state-action-bar';
export type { StateAction, StateActionTone } from './state-action-bar';

export { ConfirmActionDialog } from './confirm-action-dialog';

export { ProjectSubresourceDialog } from './project-subresource-dialog';
export type { ProjectSubresourceDialogProps } from './project-subresource-dialog';

export { ErrorPanel, ERROR_STATUS_MESSAGES } from './error-panel';

export { AuditTimeline } from './audit-timeline';
export type { AuditEvent } from './audit-timeline';
