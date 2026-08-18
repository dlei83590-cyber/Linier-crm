# Inventory Read Model — Query Contract（Design Gate → ✅ APPROVED & IMPLEMENTED）

> 状态：✅ **APPROVED & IMPLEMENTED（2026-08-18）**——设计经 Scope Gate 批准后实现：`GET /api/stock-projections` + `GET /api/inventory-movements`（+ `/{id}`）已合入 main；前端 `/inventory/stock-projection`（列表）与 `/inventory/ledger`（列表 + `[id]` 详情）已替换 Placeholder。v1 UI 过滤：物料搜索 / 仓库（下拉）/ 批次 / 序列号（location 参数后端已支持，UI 级联下拉留后续 Gate）。｜维护者：CTO｜依据：CTO Directive 2026-08-12 §15/§16、CTO #8845 Contract Blocking 解除条件、ROADMAP v1.22
> 范围：新增 **2 个只读 Query API**（`GET /api/stock-projections` + `GET /api/inventory-movements`，含 `/{id}` 详情）+ 替换 `/inventory/stock-projection` 与 `/inventory/ledger` 两个 Placeholder 页为真实页面。
> 边界：**本 Gate 不实现** Reservation / AvailableQty / Costing / FIFO / Moving Average / 库存价值（§16 红线）；不新增任何写端点；不修改 6A/6B 事实模型。

---

## 1. 目标与红线

### 1.1 目标

把前端库存只读工作台从 Placeholder 接到 **FINAL 只读 Query API**：

- **Stock Projection Query**：库存余额投影（五维：item / warehouse / location / batch / serial）——**余额唯一权威 = StockProjection SSOT**。
- **Inventory Movement Query**：不可变账本流水追溯（Trace / Audit Query）——**不是余额 API**。

### 1.2 红线（CTO Directive §14/§16，本 Gate 强制）

1. **禁止引入**：reservedQty、availableQty、unitCost、inventoryValue、FIFO layer、movingAverageCost（§16）。StockProjection 仍只表达已 FINAL 的 quantity fact。
2. **禁止前端自拼余额**：不得调多个 API 拼装余额、**不得 SUM InventoryMovement 充当 StockProjection**、不得客户端重建 StockProjection（§14）。
3. **禁止 route 动态 SUM InventoryMovement 作为正式余额实现**——余额只来自 StockProjection 表。
4. 不得为前端页面在 Read Model Gate 外新增私有/非 FINAL API。

---

## 2. 权限与 RBAC 注册（实现阶段同步，ADR-0028）

| 新权限码 | 用途 | 模块注册 |
| --- | --- | --- |
| `stock-projection:view` | GET /api/stock-projections | shared `PERMISSIONS` + `PERMISSION_MODULES` + seed `SEED_ACTION_MODULES`（`"stock-projection"`） |
| `inventory-movement:view` | GET /api/inventory-movements | shared `PERMISSIONS` + `PERMISSION_MODULES` + seed `SEED_ACTION_MODULES`（`"inventory-movement"`） |

- 同步更新 shared constants 中 **CTO #8845 注释**（“inventory-ledger:view 不是已存在的生产权限事实”）——Read Model FINAL 后该阻塞解除，改为正式只读权限说明。
- seed 与 static registry 必须同时注册，避免 RBAC drift（PR #75 教训 / ADR-0028：`API referenced permission ⊆ ALL_ACTION_PERMISSIONS`）。

---

## 3. `GET /api/stock-projections`（库存余额投影，只读）

### 3.1 参数

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| page / pageSize | int | 分页（parsePagination，pageSize ≤ 100，默认 20） |
| item | string | Item.code / Item.name contains（insensitive） |
| itemId | string | 物料精确过滤 |
| warehouseId | string | 仓库精确过滤 |
| locationId | string | 库位精确过滤 |
| batchNo | string | 批次精确过滤 |
| serialNo | string | 序列号精确过滤 |

### 3.2 排序

默认 `updatedAt desc`（对齐现有列表页）；**不提供 sortBy 参数**（YAGNI，后续 Gate 可加）。

### 3.3 响应（Paginated Envelope）

```jsonc
{
  "items": [
    {
      "id": "cuid",
      "warehouse": { "id": "…", "name": "…" },
      "location": { "id": "…", "name": "…" } | null,
      "item": { "id": "…", "code": "…", "name": "…" },
      "batchNo": "…" | null,
      "serialNo": "…" | null,
      "onHandQty": "123.0000",   // Decimal 字符串（防精度丢失，禁 toNumber）
      "lastMovementAt": "ISO" | null,
      "updatedAt": "ISO"
    }
  ],
  "page": 1, "pageSize": 20, "total": 123
}
```

- 实现：`prisma.stockProjection.findMany({ where, include: { warehouse, location, item }, orderBy: { updatedAt: "desc" }, skip, take })` + `count`。
- **不返回 `dimensionKey`**（内部查询/锁键，非业务字段）。
- `onHandQty` 由 DB CHECK 保证 ≥ 0；一行 = 一个五维组合的当前余额（PG16 `UNIQUE NULLS NOT DISTINCT`，Migration 0025）。

---

## 4. `GET /api/inventory-movements`（库存流水，只读 Trace/Audit Query）

### 4.1 参数

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| page / pageSize | int | 分页（同上） |
| item | string | Item.code / Item.name contains（insensitive） |
| itemId | string | 物料精确过滤 |
| warehouseId | string | 仓库精确过滤 |
| locationId | string | 库位精确过滤 |
| movementType | enum | InventoryMovementType（如 INBOUND/OUTBOUND/TRANSFER_OUT/TRANSFER_IN/CONSUME/PRODUCE/ADJUSTMENT…按 schema 枚举） |
| direction | enum | IN / OUT |
| sourceType | enum | InventoryMovementSourceType（如 WAREHOUSE_RECEIPT_LINE / PURCHASE_RETURN_LINE / TRANSFER / ADJUSTMENT / CONVERSION / REVERSAL / CORRECTION…按 schema 枚举） |
| sourceId | string | 来源单据 id（精确） |
| movementGroupId | string | 编组（Transfer/Conversion 多笔 Movement）精确过滤 |
| dateFrom / dateTo | ISO datetime | committedAt 范围（含边界） |

### 4.2 排序

默认 `committedAt desc`（账本时间序）。

### 4.3 响应（Paginated Envelope）

```jsonc
{
  "items": [
    {
      "id": "cuid",
      "movementNo": "MV-2026-000001",
      "sourceType": "…", "sourceId": "…", "sourceLineId": "…",
      "movementRole": "…", "movementAtomKey": "…",
      "movementGroupId": "…" | null,
      "direction": "IN" | "OUT",
      "status": "COMMITTED",
      "movementType": "…",
      "reversalOfMovementId": "…" | null,
      "correctionOfMovementId": "…" | null,
      "warehouse": { "id": "…", "name": "…" },
      "location": { "id": "…", "name": "…" } | null,
      "item": { "id": "…", "code": "…", "name": "…" },
      "batchNo": "…" | null, "serialNo": "…" | null,
      "mfgDate": "ISO" | null, "expDate": "ISO" | null,
      "quantity": "1.0000",   // Decimal 字符串
      "uom": { "id": "…", "name": "…" } | null,
      "referenceNo": "…" | null, "remark": "…" | null,
      "committedAt": "ISO", "committedById": "…" | null
    }
  ],
  "page": 1, "pageSize": 20, "total": 456
}
```

- 实现：`prisma.inventoryMovement.findMany({ where, include: { warehouse, location, item, uom }, orderBy: { committedAt: "desc" }, skip, take })` + `count`。
- 追源头：sourceType/sourceId/sourceLineId + movementGroupId + reversal/correction 链（只读展示，前端不聚合）。
- **声明**：本端点 = Trace/Audit Query，**不是余额 API**——前端禁止 SUM quantity 当余额（§14 红线）。

---

## 5. 前端页面（实现阶段）

| 路由 | 形态 | 内容 |
| --- | --- | --- |
| `/inventory/stock-projection` | 列表（只读） | 过滤：物料搜索 / 仓库 / 库位 / 批次；列：物料、仓库、库位、批次、序列号、onHandQty、lastMovementAt；`PermissionGuard(stock-projection:view)`；无新建入口 |
| `/inventory/ledger` | 列表（只读） | 过滤：物料 / 仓库 / 库位 / movementType / direction / sourceType / 日期范围；列：movementNo、committedAt、方向、类型、来源类型、物料、仓库/库位、quantity、referenceNo；行链接 → 详情 |
| `/inventory/ledger/[id]` | 详情（只读） | 单条 Movement 完整字段（含来源链 movementGroupId / reversal / correction / remark） |

- 复用共享层：`AppPage` + `EntityListWorkspace` + `StatusBadge` + `useListQuery` + `PermissionGuard` + `formatDate`（F2-3 模式），**不复制十套 fetch/error/loading**（CTO Directive §12）。
- Decimal 渲染：`onHandQty` / `quantity` 显示字符串（保留小数位展示），**不 toNumber**（对齐 format.ts 纪律）。
- 错误映射：400（非法枚举/日期 → VALIDATION_ERROR）、401、403 复用既有 ERROR_CODES 前端映射。

---

## 6. 文档同步（同一 PR）

- `docs/openapi.yaml`：+2 paths（GET /api/stock-projections、GET /api/inventory-movements）+ schemas（StockProjectionListResponse / StockProjectionItem、InventoryMovementListResponse / InventoryMovementItem / 复用 ItemSummary、WarehouseSummary、LocationSummary）。
- `docs/frontend/API_Contract_Map.md` / `Frontend_Module_Map.md` / `Page_Route_Map.md` / `Error_Permission_UX_Matrix.md`：移除 **QUERY CONTRACT GAP / HOLD** 标记，改为 FINAL Read API 契约。
- `docs/ERROR_CODES.md`：无需新错误码（非法枚举/日期 → 400 VALIDATION_ERROR 复用）。
- `docs/EVENTS.md`：无需新事件（只读查询不产生领域事件）。
- 已知文档缺口（**不在本 Gate 范围**，单独 backlog）：`/api/warehouses` 等 Master-Data Read API（PR #33）未写入 openapi.yaml。

---

## 7. 验收标准

1. 两页在 Production（Railway）真实数据渲染（列表 + 过滤 + 分页 + 详情）。
2. 权限 fail-closed：无 `stock-projection:view` / `inventory-movement:view` 的角色访问 → 403；SUPER_ADMIN 可读。
3. 余额正确性：Stock Projection 页数值 = 后端 StockProjection SSOT（**不是** SUM Movement）。
4. 静态审计：新 API 引用权限 ⊆ `ALL_ACTION_PERMISSIONS`（ADR-0028）。
5. GitHub CI 全绿（Quality Gates / Build / Secret Scanning）+ 生产部署验证（/api/health/ready baseline=0028）。
