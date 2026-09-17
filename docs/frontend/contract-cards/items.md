# Contract Card — 物料管理

- 模块：`items`（基础资料 · 物料管理）
- 判定：**Ready（F2-2 Wave 1 已交付）**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-2 Wave 1
- Backend Contract：list / detail / create / edit / ~workflow / ~factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：list / detail / create / edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

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

## 字段契约（技术属性 / 商品来源，2026-09-17 用户指令「物料管理 修改一」）

| 分区     | 字段              | 后端事实                                            | 页面                    |
| -------- | ----------------- | --------------------------------------------------- | ----------------------- |
| 商品来源 | `sourcingType`    | `ItemSourcingType`：BOUGHT / SELF_MANUFACTURED / OEM_OUTSOURCED（含工不含料）/ OEM_OUTSOURCED_FULL（含工含料，Migration 0056） | 新建/编辑下拉、详情、BOM 详情 |
| 技术属性 | 系列/型号/规格/OEM 编码 | `Item.series/model/spec/oemCode`                       | 新建/编辑、详情         |
| 技术属性 | 产品精度等级      | `Item.precisionGrade`（Migration 0056）               | 新建/编辑、详情         |
| 技术属性 | 预压值            | `Item.preload`（Migration 0056）                      | 新建/编辑、详情         |
| 技术属性 | 已移除呈现        | `Item.variant/barcode/drawingNo/drawingVersion/revision`（列与 API 保留，页面不再呈现） | —                       |

## Frontend Current State（ui 层事实，2026-08-14）

| 能力              | 状态                           |
| ----------------- | ------------------------------ |
| List              | ⏸️ 未开放（占位页/入口未开放） |
| Detail            | ⏸️ 未开放（占位页/入口未开放） |
| Create            | ⏸️ new 页面未入 main           |
| Edit              | ⏸️ edit 页面未入 main          |
| Submit / Workflow | HOLD（Tier 2 HARD HOLD）       |
| Fact Actions      | HOLD（Tier 3 HARD HOLD）       |

## Current UI

- 真实列表页（EntityListWorkspace）+ 详情页（EntityDetailWorkspace + 审计）+ 新建/编辑表单（EntityFormWorkspace + ReferenceSelector + CAS version）

- 占位页（PlaceholderPage「尚未开放」），无列表/表单

## Gap

- - 无剩余 Gap；审计已通过 /api/audit-logs（entityType=item）接入
- UX Hardening（CTO #11660）：Dirty-State Guard（useDirtyStateGuard）+ 409 CAS 冲突专用面板（isVersionConflict + 重新加载）已接入

- 列表页（EntityListWorkspace）、详情（EntityDetailWorkspace）、Create/Edit 表单（EntityFormWorkspace + LineEditor）全部缺失 → F2-2 实现
