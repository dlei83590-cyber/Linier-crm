# Workspace Primitives — 工作区原语（F2-1 UI System Foundation）

- 状态：F2-1 Wave 0 交付（2026-08-14）
- 位置：`apps/web/src/components/workspace/`（统一出口 `index.ts`）

> 规则：业务页面只从 `@/components/workspace` 导入原语；禁止绕过统一层自造布局。
> 存量成熟页面暂不大改（迁移期），F2-2 起的全部新页面必须消费本层。

---

## 1. 页面外壳

| 原语          | 职责                                           | 关键 props                       |
| ------------- | ---------------------------------------------- | -------------------------------- |
| `AppPage`     | 页面容器：背景 / 内容宽度（maxWidth）/ 密度    | `maxWidth?`、`density?`          |
| `PageHeader`  | 页面头部：返回链接 → 标题 → 描述 → 右侧操作区  | `title`、`backHref?`、`actions?` |
| `PageToolbar` | 工具条：左筛选（children） + 右操作（actions） | `children?`、`actions?`          |

## 2. 页面工作区（结构规范载体）

| 原语                    | 结构                                               | 关键 props                                                             |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `EntityListWorkspace`   | Header → Toolbar(Filters) → Table → Pagination     | `columns`、`rows`、`rowKey`、`loading`、`error`、`onRetry`、分页四元组 |
| `EntityDetailWorkspace` | Header(状态+操作) → Summary → Sections → Audit     | `status?`、`actions?`、`summary?`、`audit?`                            |
| `EntityFormWorkspace`   | Header → Sections/Lines → Validation → Save/Cancel | `mode`、`submitting`、`error?`、`onSave`、`onCancel`                   |

> **F2-2 UX Hardening（CTO #11660，全表单统一）**：
> - **Dirty-State Guard**：传 `dirty`（Create 页填写内容后即 true）+ `onDirty`（内容容器 onInput 冒泡自动标记）→ 自动挂 beforeunload + Cancel/Back 显式确认（共享 `useDirtyStateGuard`，`apps/web/src/lib/use-dirty-state-guard.ts`）
> - **409 VERSION_CONFLICT**：传 `onReload`（重新 GET → 更新 version → 重置 dirty）→ 显示专用 conflict 面板（「该记录已被其他操作更新，请重新加载最新数据后再编辑。」+ 重新加载按钮），不再只当普通 ErrorPanel；禁止 silent retry / 自动覆盖 / 自动重新 PATCH（共享 `isVersionConflict`，`apps/web/src/lib/api-client.ts`）

## 3. 选择器

| 原语                | 职责                                            | 说明                                                   |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| `ReferenceSelector` | 引用实体选择（Item/Supplier/Warehouse/UOM/PO…） | 受控组件，options 由业务层提供；loading/error 状态内置 |
| `DependentSelector` | 级联选择（仓库→库位、类别→物料→UOM）            | 上级变更自动清空下级；数据由业务层提供                 |

## 4. 行编辑

| 原语         | 职责                                  | 关键 props                                                                          |
| ------------ | ------------------------------------- | ----------------------------------------------------------------------------------- |
| `LineEditor` | 单据行编辑表（PO/Receipt/Invoice 行） | `columns`（text/number/select/readonly）、`lines`、`onChange`、`onAdd`、`onRemove?` |

## 5. 状态与动作

| 原语                  | 职责           | 说明                                                                                |
| --------------------- | -------------- | ----------------------------------------------------------------------------------- |
| `StatusBadge`         | 统一状态徽章   | tone 优先级：显式 tone > toneMap > 默认映射 > neutral；内部 key 保留真实 enum       |
| `StateActionBar`      | 状态机动作栏   | actions 由业务层按 State_Action_Matrix 解析（前端不发明规则）；confirm 动作二次确认 |
| `ConfirmActionDialog` | 动作确认对话框 | 破坏性/不可逆动作二次确认；Esc 取消；busy 禁用                                      |

## 6. 状态呈现

| 原语            | 职责         | 说明                                                                                                        |
| --------------- | ------------ | ----------------------------------------------------------------------------------------------------------- |
| `ErrorPanel`    | 统一错误面板 | 400 校验 / 401 会话 / 403 权限 / 404 不存在 / 409 冲突 / 500 系统+requestId / 0 网络；禁止 Prisma/SQL/stack |
| `AuditTimeline` | 审计时间线   | 详情页 Audit 区；action 保留真实后端 key；时间走 `formatDate`                                               |

---

## 消费约定（各 Wave 必须遵守）

1. 列表页 = `AppPage` + `EntityListWorkspace`（分页状态来自 `useListQuery`）
2. 详情页 = `AppPage` + `EntityDetailWorkspace`（`StateActionBar` 承载动作）
3. 表单页 = `AppPage` + `EntityFormWorkspace` + `LineEditor`（行）+ `ReferenceSelector`/`DependentSelector`
4. 错误一律 `ErrorPanel`；状态一律 `StatusBadge`/`StateActionBar`
5. 禁止页面内 new 一套布局/错误/状态呈现
