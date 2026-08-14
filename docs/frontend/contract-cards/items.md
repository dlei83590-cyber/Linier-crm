# Contract Card — 物料管理

- 模块：`items`（基础资料 · 物料管理）
- 判定：**可开发**（Backend FINAL + Frontend Missing）
- 归属 Wave：F2-2 Wave 1
- 能力（Registry）：list / detail / create / edit（workflow / factActions 无）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力   | 端点                           | 方法   | 说明                             |
| ------ | ------------------------------ | ------ | -------------------------------- |
| List   | `/api/items`                   | GET    | 分页/筛选（code/name/类别等）    |
| Detail | `/api/items/{id}`              | GET    | 详情（含规格/成本/供应商子资源） |
| Create | `/api/items`                   | POST   | —                                |
| Edit   | `/api/items/{id}`              | PATCH  | CAS version                      |
| Delete | `/api/items/{id}`              | DELETE | —                                |
| Sub    | `/api/items/{id}/revisions` 等 | GET    | 版本/规格/成本/供应商/标签/附件  |

## Permission

- `item:view` / `item:create` / `item:edit`（动作级权限已 seed，RBAC 已注册）

## Status Machine

- 主数据无审批状态机（`isActive` 启用/停用）

## Selectors

- UOM（`/api/unit-of-measures`，GET FINAL）
- Item Category（`/api/item-categories`，GET FINAL）

## Error Codes

- 409：version 冲突（并发编辑）
- 422：校验失败（必填/格式）

## Current UI

- 占位页（PlaceholderPage「尚未开放」），无列表/表单

## Gap

- 列表页（EntityListWorkspace）、详情（EntityDetailWorkspace）、Create/Edit 表单（EntityFormWorkspace + LineEditor）全部缺失 → F2-2 实现
