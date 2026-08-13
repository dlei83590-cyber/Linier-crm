# Batch 3 Readiness Recheck（PO / Receipt / WHR Selector 映射核验）

- 基线：`main @ 268b4059`（PR #33 Master-Data Read API + PR #34 Auth Transport + PR #35 Release Metadata + PR #36 Governance 全部合入）
- 目的：核验 Batch 3（Purchase Order / Purchase Receipt / Warehouse Receipt）Create/DRAFT Edit 表单对**刚落地的** Warehouse / Location / UOM read API 的真实 selector 映射、权限与返回 envelope；确认无新的 contract gap 后再解除 implementation HOLD。
- 方法：静态勘查（仅读）；不开代码；CI-First。

---

## 0. 前置事实（已合入 main）

| 交付 | PR | 状态 |
|---|---|---|
| Warehouse / Location / UOM 只读 API + RBAC 注册 | #33 | MERGED |
| Frontend Auth Transport（apiFetch + Bearer） | #34 | MERGED |
| Release Metadata + Dashboard Cleanup | #35 | MERGED |
| Governance Refresh | #36 | MERGED |

三个新 read API（均 GET only、`ok(items, meta)` 形态 A、parsePagination 上限 100）：

| Endpoint | Permission | 关键 filter |
|---|---|---|
| `GET /api/warehouses` | `warehouse:view` | page/pageSize/code/name/type/isActive |
| `GET /api/warehouse-locations` | `warehouse-location:view` | +warehouseId（按仓查库位）|
| `GET /api/unit-of-measures` | `unit-of-measure:view` | D3：默认 isActive=true |

## 1. Selector 映射核验（对照 Tier1_ScaleOut_Readiness_Review §1-4）

### Purchase Order（Batch 3）
| Selector | 需要 | Read API 来源 | 状态 |
|---|---|---|---|
| supplierId | ✅ | `/api/suppliers`（已存在） | ✅ |
| itemId | ✅ | `/api/items`（已存在） | ✅ |
| **uomId** | ✅ | **`/api/unit-of-measures`（新，PR #33）** | ✅ **GAP 已解除** |
| purchaserId / departmentId | 可选（contract 标注可选） | users / departments = P1（未做，不阻塞） | ⚪ P1 |

### Purchase Receipt（Batch 3）
| Selector | 需要 | Read API 来源 | 状态 |
|---|---|---|---|
| purchaseOrderId | ✅ | `/api/purchase-orders`（已存在） | ✅ |
| purchaseOrderLineId | ✅ | 经 PO 详情 | ✅ |
| **warehouseId**（可选，仅 WAREHOUSE 场景） | ⚪ 可选 | **`/api/warehouses`（新）** | ✅ **GAP 已解除** |

### Warehouse Receipt（Batch 3）
| Selector | 需要 | Read API 来源 | 状态 |
|---|---|---|---|
| purchaseReceiptId | ✅ | `/api/purchase-receipts`（已存在） | ✅ |
| purchaseReceiptLineId / inspectionId | ✅ | 经 Receipt/Inspection 详情 | ✅ |
| **warehouseId（必填）** | ✅ | **`/api/warehouses`（新）** | ✅ **GAP 已解除** |
| **locationId（可选，组合 FK 同属）** | ⚪ 可选 | **`/api/warehouse-locations?warehouseId=`（新）** | ✅ **GAP 已解除** |

## 2. 权限核验（真实 endpoint 权限码）

`PERMISSION_MODULES` 已注册（PR #33 补 `warehouse`/`warehouse-location`，`unit-of-measure` 既有）：

- `warehouse:view` ✅ 可授予（SUPER_ADMIN/ADMIN 静态 + seed 已注册）
- `warehouse-location:view` ✅ 可授予（SEED_RESTRICTED 已注册）
- `unit-of-measure:view` ✅ 可授予（PERMISSION_MODULES 已注册；D2 单一口径，无 :read/:view 双体系）

业务模块权限（PR #30 已注册，前端 guard 用真实码）：

- `purchase-order:create/edit/view` ✅
- `purchase-receipt:create/edit/view` ✅
- `warehouse-receipt:create/edit/view` ✅

## 3. 返回 envelope 核验

- 三个新 API 均为 `ok(items, { page, pageSize, total })`（形态 A：`data: T[]` + `meta`）
- `useListQuery` 已兼容双形态（A: data[]+meta / B: data{items}），且对缺 `meta.total` 的声明分页抛结构化 CONTRACT_GAP，禁止静默降级
- 与 items/suppliers 列表消费方式一致，Batch 3 表单 selector 可直接复用现有模式

## 4. 结论

- **BLOCKED — SELECTOR CONTRACT：已全部解除**（UOM / Warehouse / Location 三个 selector gap 均由 PR #33 关闭）
- **BLOCKED — RBAC：已全部解除**（PR #28/#30/#33 注册后真实码可授予）
- **无新增 contract gap**：剩余 P1（users / departments）均为 contract 可选字段，不阻塞表单实现
- 前端入口已就绪：orders / receipts / warehouse-receipts 均有 list/detail 页且使用 `useListQuery`（Auth Transport 合入后经统一 transport 带 Bearer）

## 5. 建议

Batch 3（PO / Receipt / WHR）Create + DRAFT Edit 的 **implementation HOLD 可解除**，进入实现 Gate；实现时按 Batch 1/2 Reference 模式（真实权限码、dirty state、结构化错误、409 CAS 不自动 retry、success convergence），Warehouse/Location/UOM selector 用 FINAL read API（`/api/warehouses`、`/api/warehouse-locations?warehouseId=`、`/api/unit-of-measures`），不再使用 ID 输入 fallback。
