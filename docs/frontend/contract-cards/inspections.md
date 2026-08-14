# Contract Card — 质检记录

- 模块：`inspections`（采购管理 · 质检记录）
- 判定：**迁移**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-3
- 能力（Registry）：list / detail / create / edit / factActions（workflow 无）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                             | 方法  | 说明                                                     |
| ------- | -------------------------------- | ----- | -------------------------------------------------------- |
| List    | `/api/inspections`               | GET   | 分页/筛选                                                |
| Detail  | `/api/inspections/{id}`          | GET   | —                                                        |
| Create  | `/api/inspections`               | POST  | —                                                        |
| Edit    | `/api/inspections/{id}`          | PATCH | CAS version（仅 DRAFT）                                  |
| Actions | `/api/inspections/{id}/complete` | POST  | 完成（qualifiedQty + rejectedQty = inspectableQty 强制） |

## Permission

- `inspection:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- DRAFT → COMPLETED；终态 CANCELLED
- 结果枚举：QUALIFIED / PARTIAL / REJECTED（StatusBadge 语义色映射）

## Selectors

- Receipt（`/api/purchase-receipts`）、Item、UOM

## Error Codes

- 400：数量校验（合格+拒收 ≠ 应检）
- 409：version 冲突 / 状态不允许 complete

## Current UI

- 成熟列表页 + 详情页（真实 API 消费，非占位）

## Gap

- 接入统一 Workspace（EntityListWorkspace / EntityDetailWorkspace / EntityFormWorkspace / StatusBadge / ErrorPanel / ReferenceSelector / LineEditor）
- 保留现有业务逻辑；Create/Edit 从旧 PR #38 选择性吸收
