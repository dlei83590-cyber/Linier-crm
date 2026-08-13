# Master-Data Read API Design（DESIGN ONLY — 不实现）

- 基线：`main @ 3a80e94`（PR #29 Readiness Review + PR #30 RBAC Registry 已合并）
- 分支：`docs/master-data-read-api-design`
- 目的：为 Tier 1 Scale-Out（Batch 3/4）提供 Warehouse / Warehouse Location / UOM 三类主数据的 **FINAL read API 设计**，解除 Selector CONTRACT GAP。
- 原则：**DESIGN ONLY**。不新增 backend route、不改 Prisma/migration、不在前端 PR 补 endpoint。设计经 CTO 批准后再单独开实现 Gate。

---

## 0. 设计范围（CTO 14:27 指令）

**P0 评估对象（直接阻塞 PO/Receipt/WHR/Inventory 产品化表单）**：

1. Warehouse（仓库）
2. Warehouse Location（库位，组合 FK 依赖 warehouse）
3. UOM（计量单位）

**P1（本轮仅登记，不设计）**：User（purchaser 等）、Department —— 除非具体 Create/Edit contract 明确必须依赖（当前 PO purchaserId/departmentId 均为可选，暂列 P1）。

## 1. 消费方（谁需要这些 read API）

| 模块                                 | 需要 selector                                               | 当前状态                  |
| ------------------------------------ | ----------------------------------------------------------- | ------------------------- |
| Purchase Order（Batch 3）            | Supplier✅ / Item✅ / **UOM❌** / User❌(P1) / Dept❌(P1)   | BLOCKED — SELECTOR（UOM） |
| Purchase Receipt（Batch 3）          | PO✅ / **Warehouse❌**                                      | BLOCKED — SELECTOR        |
| Warehouse Receipt（Batch 3）         | Receipt✅ / Inspection✅ / **Warehouse❌ / Location❌**     | BLOCKED — SELECTOR        |
| Inventory Adjustment（Batch 4）      | Item✅ / **Warehouse❌ / Location❌ / UOM❌**               | READY WITH UX GAP         |
| Inventory Conversion（Batch 4）      | Item✅ / **UOM❌ / Warehouse❌ / Location❌**               | READY WITH UX GAP         |
| Inventory Transfer（Batch 1 已交付） | **Warehouse❌ / Location❌**（ID 输入 + CONTRACT GAP 标注） | 待产品化                  |

> 现有可复用：`/api/items`（Item, item:view）、`/api/suppliers`、`/api/dictionaries`（reasonCode 等）。

## 2. Warehouse Read API

**Endpoint**：`GET /api/warehouses`

**Permission**：`warehouse:view`（⚠️ 依赖：shared `PERMISSION_MODULES` 未注册 `warehouse` 模块，seed 已注册 → 实现本 API 前需先补 RBAC registry 注册（与 PR #28/#30 同型最小修复），否则 read API 同样全角色 403）

**SSOT**：Prisma `Warehouse` 模型（`prisma/schema.prisma`）—— 仓库主数据由 Warehouse 域维护，非前端/单据推导。

**Query / Filter**（对齐 items 列表模式）：

- `page` / `pageSize`（parsePagination，上限 100）
- `code`（contains, insensitive）
- `name`（contains, insensitive）
- `type`（精确，可选）
- `isActive`（精确布尔，可选）
- 默认 `where: { deletedAt: null }`，`orderBy: { createdAt: 'desc' }`

**Response**（对齐 `ok(items, { page, pageSize, total })`）：

```
{ success: true, data: [ { id, code, name, type, address, remark, isActive, version, createdAt, updatedAt } ], meta: { page, pageSize, total } }
```

**模型字段**（schema 实勘）：`id / code(unique) / name / type? / address? / remark? / isActive(default true) / version / deletedAt / createdAt / updatedAt`。

## 3. Warehouse Location Read API

**Endpoint**：`GET /api/warehouse-locations`

**Permission**：`warehouse-location:view`（⚠️ 同样依赖 shared `PERMISSION_MODULES` 注册 `warehouse-location`，seed 已注册）

**SSOT**：Prisma `WarehouseLocation` 模型 —— 组合 FK `[warehouseId, code]` unique、`[id, warehouseId]` unique（支撑单据组合 FK 校验）。

**Query / Filter**：

- `page` / `pageSize`
- `warehouseId`（**必选过滤建议**：库位总是按仓库查，避免跨仓全量；或可选 + 上限保护）
- `code` / `name`（contains）
- `isActive`（可选）
- 默认 `deletedAt: null`，`orderBy: { createdAt: 'desc' }`；include `warehouse: { select: { id, code, name } }`（供显示）

**Response**：

```
{ success: true, data: [ { id, warehouseId, warehouse: { id, code, name }, code, name, isActive, version, createdAt, updatedAt } ], meta: { page, pageSize, total } }
```

**模型字段**：`id / warehouseId / code / name / isActive(default true) / version / deletedAt / createdAt / updatedAt`。

## 4. UOM Read API

**Endpoint**：`GET /api/unit-of-measures`

**Permission**：`unit-of-measure:view`（✅ shared `PERMISSION_MODULES` 已注册 `unit-of-measure`；⚠️ 注意 shared `PERMISSIONS.UNIT_OF_MEASURE_READ` 常量值是 `"unit-of-measure:read"`，与动作码 `unit-of-measure:view` 命名不一致 —— 前端 guard 应采用真实 endpoint 权限码 `unit-of-measure:view`，并建议后续对齐常量命名，属 P1 cleanup）

**SSOT**：Prisma `UnitOfMeasure` 模型。

**Query / Filter**：

- `page` / `pageSize`
- `code` / `name`（contains）
- `isActive`（可选）
- `approvalStatus`（可选；模型含 DRAFT/APPROVED 审批状态 —— 设计问题待定：UOM 是否只暴露 APPROVED？建议实现时按主数据消费惯例默认全量 + isActive 过滤，审批语义按 CTO 决策）
- 默认 `deletedAt: null`，`orderBy: { createdAt: 'desc' }`

**Response**：

```
{ success: true, data: [ { id, code, name, symbol, isActive, approvalStatus, version, createdAt, updatedAt } ], meta: { page, pageSize, total } }
```

**模型字段**：`id / code(unique) / name / symbol? / isActive(default true) / approvalStatus(default DRAFT) / version / deletedAt`。

## 5. 实现前置依赖（Gate 顺序）

| #   | 依赖                                                                      | 类型                   | 说明                                                     |
| --- | ------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------- |
| D1  | `warehouse` / `warehouse-location` 模块注册进 shared `PERMISSION_MODULES` | RBAC registry 最小修复 | 与 PR #28/#30 同型；否则 3 个 read API 中 2 个全角色 403 |
| D2  | `unit-of-measure:view` vs `unit-of-measure:read` 命名对齐                 | 常量 cleanup（P1）     | 不阻塞实现，前端用真实 endpoint 码即可                   |
| D3  | UOM approvalStatus 暴露策略                                               | 设计决策               | 建议默认全量 + isActive；如需仅 APPROVED 由 CTO 拍板     |

**实现 Gate 建议**（D1 落 main 后）：单 PR 新增 3 个只读 route（`/api/warehouses`、`/api/warehouse-locations`、`/api/unit-of-measures`），仅 GET，复用 items 列表模式 + 统一 ok/parsePagination 契约；随后 Batch 3（PO/Receipt/WHR）与 Batch 4（Adjustment/Conversion）表单可切换为 FINAL selector。

## 6. 本轮约束（CTO 14:27）

- ✅ DESIGN ONLY：未新增 backend route、未改 Prisma/migration、未改 shared/seed、未在 frontend PR 补 endpoint
- ✅ 不 hard-code / 不 mock / 不拼数据
- ✅ Tier 1 implementation scale-out = PARTIAL HOLD（仅 Batch 2 在 RBAC 修复后可解除，本设计服务于 Batch 3/4）；Tier 2/3 = HOLD

## 7. 验收标准（实现 Gate 时）

- GET 列表：`page/pageSize/code/name/（warehouseId for location）/isActive` 过滤 + pagination + 上限保护
- Permission：真实 endpoint 码（`warehouse:view` / `warehouse-location:view` / `unit-of-measure:view`）可被合法角色授予（D1 后）
- Response 契约与现有 `ok(data, meta)` 一致；SSOT 明确为 Prisma 主数据模型
- CI GREEN；前端 Batch 3/4 表单改用 FINAL selector 后，移除 ID 输入 fallback 标注
