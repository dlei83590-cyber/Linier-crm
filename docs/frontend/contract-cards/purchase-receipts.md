# Contract Card — 到货收货

- 模块：`purchase-receipts`（采购管理 · 到货收货）
- 判定：**迁移**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-3
- Backend Contract：list / detail / create / edit / ~workflow / factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：list / detail / create / edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                  | 方法  | 说明                           |
| ------- | ------------------------------------- | ----- | ------------------------------ |
| List    | `/api/purchase-receipts`              | GET   | 分页/筛选                      |
| Detail  | `/api/purchase-receipts/{id}`         | GET   | —                              |
| Create  | `/api/purchase-receipts`              | POST  | —                              |
| Edit    | `/api/purchase-receipts/{id}`         | PATCH | CAS version（仅 DRAFT）        |
| Actions | `/api/purchase-receipts/{id}/receive` | POST  | 收货（CONFIRMED PO 来源 Gate） |
| Actions | `/api/purchase-receipts/{id}/cancel`  | POST  | 取消                           |

## Permission

- `purchase-receipt:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- DRAFT → RECEIVED（收货事实已定）；终态 CANCELLED
- 前端只做映射表（State_Action_Matrix），不发明规则

## Selectors

- PO（`/api/purchase-orders`）、Item、Warehouse（`/api/warehouses`）、UOM

## Error Codes

- 409：状态不允许 receive / version 冲突

## Frontend Current State（ui 层事实，2026-08-14 / F2-3 Batch B1 更新）

| 能力              | 状态                                  |
| ----------------- | ------------------------------------- |
| List              | ✅（列表页已在 main）                 |
| Detail            | ✅（详情页已在 main）                 |
| Create            | ✅（Batch B1 已交付：选 PO → 真实 lines 绑定 purchaseOrderLineId） |
| Edit              | ✅（DRAFT Edit，CAS version，Batch B1）|
| Submit / Workflow | HOLD（Tier 2 HARD HOLD）              |
| Fact Actions      | HOLD（Tier 3 HARD HOLD：receive/cancel 不在本批） |

## Current UI

- 列表页 + 详情页（现有，真实 API 消费）；Create / DRAFT Edit 已由 Batch B1 以新 Workspace（EntityFormWorkspace + ReferenceSelector + LineEditor + useDirtyStateGuard + isVersionConflict）交付
- 来源链纪律：Create 选 PO → GET /api/purchase-orders/{id} → 真实 lines 绑定 purchaseOrderLineId（不 lineNo/itemId 当 identity、不重算 remaining）；Edit 保留 source identity 原样回传；来源 PO 承诺事实锁定
- 权限使用 shared constants（PERMISSIONS / actionPermission），未复制裸字符串

## Gap

- List/Detail 迁移统一 Workspace（EntityListWorkspace / EntityDetailWorkspace）→ Batch C
- Receive（收货事实）/ Cancel → HOLD（Tier 3；后续 Wave 按契约开放）
- **source-bound 纪律（CTO Batch B Review #11876）**：Receipt 行必须来自 authoritative PO Line；Create/Edit 均禁止 arbitrary add line（disableAdd）—— 如需追加 PO Line 应实现正式「从剩余 PO lines 选择并自动绑定 purchaseOrderLineId」的 selector，而非 generic empty row
