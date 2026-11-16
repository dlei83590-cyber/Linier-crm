# Contract Card — 采购订单

- 模块：`purchase-orders`（采购管理 · 采购订单）
- 判定：**迁移**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-3
- Backend Contract：list / detail / create / edit / workflow / factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：list / detail / create / edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                | 方法  | 说明                             |
| ------- | ----------------------------------- | ----- | -------------------------------- |
| List    | `/api/purchase-orders`              | GET   | 分页/筛选                        |
| Detail  | `/api/purchase-orders/{id}`         | GET   | —                                |
| Create  | `/api/purchase-orders`              | POST  | Direct / Convert 双入口          |
| Edit    | `/api/purchase-orders/{id}`         | PATCH | CAS version（仅 DRAFT）          |
| Actions | `/api/purchase-orders/{id}/submit`  | POST  | 提交（workflow）                 |
| Actions | `/api/purchase-orders/{id}/confirm` | POST  | 确认（**APPROVED ≠ CONFIRMED**） |
| Actions | `/api/purchase-orders/{id}/cancel`  | POST  | 取消（DRAFT/APPROVED）           |

## Permission

- `purchase-order:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- DRAFT → SUBMITTED → APPROVED → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED；终态 CANCELLED
- 前端只做映射表（State_Action_Matrix），不发明规则

## Selectors

- Supplier、Item、UOM（`/api/unit-of-measures`）、Warehouse（`/api/warehouses`）、Requisition（convert 来源）
- **Supplier 数据源 = `GET /api/suppliers`（Supplier 档案；提交的 `supplierId` 语义 = Supplier.id）**。
  档案是**往来单位（BusinessPartner）type=SUPPLIER/BOTH 的 1:1 角色扩展**：
  - 服务端在往来单位 create / update 时**同事务自动建档**（幂等；编码沿用往来单位编码，冲突走确定性候选编码）；
  - 历史存量由 `prisma/seed.ts` 的自愈步骤补齐（幂等；部署 update 脚本含 seed 即生效）；
  - 前端引用源**每源独立取数**（`useReferenceOptions`）+ 字段级失败可见 / 重试；供应商列表为空时
    明确提示「档案来自往来单位」并给出 `/business-partners/new` 入口，不静默留空下拉。
- Item / UOM / 付款条件同样是独立引用源：任一源失败都不得连带清空其他下拉。

## Error Codes

- 409：version 冲突 / 状态不允许动作

## Frontend Current State（ui 层事实，2026-08-14 / F2-3 Batch A 更新）

| 能力              | 状态                                  |
| ----------------- | ------------------------------------- |
| List              | ✅（列表页已在 main）                 |
| Detail            | ✅（详情页已在 main）                 |
| Create            | ✅（Batch A selective port 已交付）   |
| Edit              | ✅（DRAFT Edit，CAS version，Batch A）|
| Submit / Workflow | HOLD（Tier 2 HARD HOLD）              |
| Fact Actions      | HOLD（Tier 3 HARD HOLD）              |

## Current UI

- 列表页 + 详情页（现有，真实 API 消费）；Create / DRAFT Edit 已由 Batch A 以新 Workspace（EntityFormWorkspace + ReferenceSelector + LineEditor + useDirtyStateGuard + isVersionConflict）交付
- 权限使用 shared constants（PERMISSIONS / actionPermission），未复制裸字符串

## Gap

- List/Detail 迁移统一 Workspace（EntityListWorkspace / EntityDetailWorkspace）→ Batch C
- Submit / Approve / Confirm / Cancel / Convert → HOLD（Tier 2/3；后续 Wave 按契约开放）
- **DRAFT Edit 支持 DIRECT 与 REQUISITION 两种来源 PO**；REQUISITION 的 source identity（sourcePurchaseRequisitionLineId）全链保留且不可变（item 锁定、禁无来源新增行；backend PATCH gate：PURCHASE_ORDER_SOURCE_LINE_REQUIRED / INVALID）
