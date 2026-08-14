# Contract Card — 仓库收货

- 模块：`warehouse-receipts`（采购管理 · 仓库收货）
- 判定：**迁移**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-3
- Backend Contract：list / detail / create / edit / ~workflow / factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：list / detail / create / edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                | 方法  | 说明                                     |
| ------- | ----------------------------------- | ----- | ---------------------------------------- |
| List    | `/api/warehouse-receipts`           | GET   | 分页/筛选                                |
| Detail  | `/api/warehouse-receipts/{id}`      | GET   | —                                        |
| Create  | `/api/warehouse-receipts`           | POST  | —                                        |
| Edit    | `/api/warehouse-receipts/{id}`      | PATCH | CAS version（仅 DRAFT）                  |
| Actions | `/api/warehouse-receipts/{id}/post` | POST  | **过账（触发 6A InventoryMovement IN）** |

## Permission

- `warehouse-receipt:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- DRAFT → POSTED（库存已入账，终态证据 postedAt/postedById）；终态 CANCELLED
- **Created ≠ Posted**：post 为唯一入账事实动作

## Selectors

- Receipt（`/api/purchase-receipts`）、Inspection（`/api/inspections`）、Warehouse（`/api/warehouses`）、Location（`/api/warehouse-locations`）、Item

## Error Codes

- 409：状态不允许 post / version 冲突

## Frontend Current State（ui 层事实，2026-08-14）

| 能力              | 状态                                  |
| ----------------- | ------------------------------------- |
| List              | ✅（列表页已在 main）                 |
| Detail            | ✅（详情页已在 main）                 |
| Create            | ✅（Batch B2 已交付：选 Receipt → WAREHOUSE 行 + 合法 Inspection 候选） |
| Edit              | ✅（DRAFT Edit，双 source identity 保留，Batch B2） |
| Submit / Workflow | HOLD（Tier 2 HARD HOLD）              |
| Fact Actions      | HOLD（Tier 3 HARD HOLD：post 不在本批）|

## Current UI

- 列表页 + 详情页（现有，真实 API 消费）；Create / DRAFT Edit 已由 Batch B2 以新 Workspace（EntityFormWorkspace + ReferenceSelector + DependentSelector + LineEditor + useDirtyStateGuard + isVersionConflict）交付
- 来源链纪律：Create 选 Receipt（RECEIVED）→ GET authoritative detail → 只显示 WAREHOUSE 来源行（DIRECT_PROJECT 禁入库）→ 每行绑定 purchaseReceiptLineId + 合法 inspectionId（属于同一收货行且已完成 + qualifiedQty>0）；warehouse → location dependent（warehouseId 改变 → 清空 locationId → 重新加载）；serialNos 文本输入但提交前 split/trim/dedupe 成数组
- Edit 保留双 source identities 原样回传；换 Inspection 仅限同一收货行合法候选
- 权限使用 shared constants（PERMISSIONS / actionPermission），未复制裸字符串

## Gap

- List/Detail 迁移统一 Workspace（EntityListWorkspace / EntityDetailWorkspace）→ Batch C
- Post（过账，触发 6A InventoryMovement）→ HOLD（Tier 3；后续 Wave 按契约开放）
