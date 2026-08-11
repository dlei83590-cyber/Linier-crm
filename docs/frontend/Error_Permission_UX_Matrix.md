# Frontend Operations Workspace — Error / Permission UX Matrix（错误码与权限 UX 矩阵）

- 版本：v0.1（Track A 首批交付，CTO #8777 Post-6B Portfolio Gate）
- 分支：`feature/frontend-operations-workspace`（从 main @ `874e060` 创建）
- 日期：2026-08-11
- 状态：**Page Skeleton 阶段——映射表供后续迭代错误提示/权限守卫使用，骨架页不实现**

> **原则（CTO 红线）**：错误提示一律映射后端稳定错误码（`lib/api/errors.ts` `ERROR_CODES`），**不吞错误、不发明错误**；403/409/400/404 区分展示；权限守卫用 `PermissionGuard`（对齐现有页面先例）。

---

## 1. 权限守卫矩阵（页面级）

| 模块 | 页面 | 权限码（view） | 无权限表现 |
| --- | --- | --- | --- |
| Purchase Requisition | `/purchasing/requisitions` | `purchase-requisition:view` | `<Forbidden />` |
| Purchase Order | `/purchasing/orders` | `purchase-order:view` | `<Forbidden />` |
| Purchase Receipt | `/purchasing/receipts` | `purchase-receipt:view` | `<Forbidden />` |
| Inspection | `/purchasing/inspections` | `inspection:view` | `<Forbidden />` |
| Warehouse Receipt | `/purchasing/warehouse-receipts` | `warehouse-receipt:view` | `<Forbidden />` |
| Purchase Return | `/purchasing/returns` | `purchase-return:view` | `<Forbidden />` |
| Stock Projection | `/inventory/stock-projection` | `inventory-ledger:view` | `<Forbidden />` |
| Inventory Movement Ledger | `/inventory/ledger` | `inventory-ledger:view` | `<Forbidden />` |
| Inventory Transfer | `/inventory/transfers` | `inventory-transfer:view` | `<Forbidden />` |
| Stock Count | `/inventory/stock-counts` | `stock-count:view` | `<Forbidden />` |
| Inventory Adjustment | `/inventory/adjustments` | `inventory-adjustment:view` | `<Forbidden />` |
| Conversion / Repack | `/inventory/conversions` | `inventory-conversion:view` | `<Forbidden />` |

> 按钮级权限（后续迭代）：create → `{module}:create`；PATCH/submit/execute/post/complete/receive/return/confirm → `{module}:edit`；cancel → `{module}:close`；**Adjustment apply → `inventory-adjustment:apply`（受限系统权限，仅 SUPER_ADMIN/ADMIN——前端按钮对非管理员隐藏，后端仍 403 兜底）**。

---

## 2. 业务错误码映射（前端中文提示模板）

### 2.1 通用错误

| 后端错误码 | HTTP | 前端提示（模板） | 处置 |
| --- | --- | --- | --- |
| `VERSION_CONFLICT` | 409 | 「数据已被他人更新，请刷新后重试」 | 刷新/重新拉取后重试（**version conflict UI**） |
| `NOT_FOUND` | 404 | 「记录不存在或已删除」 | 返回列表 |
| `FORBIDDEN` | 403 | 「您没有执行该操作的权限」 | 隐藏按钮/跳转 403 |
| `UNAUTHORIZED` | 401 | 「登录已过期，请重新登录」 | 跳转登录 |
| `VALIDATION_ERROR` | 400 | 展示字段级错误 | 表单内联提示 |
| `INTERNAL_ERROR` | 500 | 「系统繁忙，请稍后重试」 | 记录后重试 |

### 2.2 采购模块（5A/5B）

| 后端错误码 | HTTP | 前端提示（模板） |
| --- | --- | --- |
| `PURCHASE_ORDER_INVALID_STATE` | 409 | 「当前状态不允许该操作」（如 APPROVED 前不可 Confirm） |
| `PURCHASE_ORDER_ALREADY_CONFIRMED` | 409 | 「采购订单已确认，不可重复确认」 |
| `PURCHASE_ORDER_APPROVED_NE_CONFIRMED` | 409 | 「审批通过 ≠ 订单确认，请执行确认操作」 |
| `PURCHASE_RECEIPT_SOURCE_INVALID` | 400 | 「仅 CONFIRMED/部分收货的采购订单可收货」 |
| `PURCHASE_RECEIPT_ALREADY_RECEIVED` | 409 | 「收货单已完成收货，不可重复操作」 |
| `INSPECTION_RESULT_MISMATCH` | 400 | 「合格数量 + 拒收数量必须等于检验数量」 |
| `WAREHOUSE_RECEIPT_ALREADY_POSTED` | 409 | 「入库单已过账，不可重复过账」 |
| `PURCHASE_RETURN_SOURCE_EXCEEDED` | 400 | 「退货数量超过来源可退余额」 |
| `PURCHASE_RETURN_ALREADY_RETURNED` | 409 | 「退货单已完成，不可重复退货」 |

### 2.3 库存模块（6A/6B）

| 后端错误码 | HTTP | 前端提示（模板） |
| --- | --- | --- |
| `INVENTORY_INSUFFICIENT_STOCK` | 409 | 「库存不足，无法执行」（OUT 方向禁负库存） |
| `INVENTORY_LEDGER_IDEMPOTENCY_CONFLICT` | 409 | 「相同业务事实已入账，请勿重复提交」 |
| `INVENTORY_TRANSFER_SELF_TRANSFER` | 409 | 「源仓库与目标仓库相同，禁止自调拨」 |
| `INVENTORY_TRANSFER_ALREADY_EXECUTED` | 409 | 「调拨单已执行，重复执行已拒绝（幂等）」 |
| `INVENTORY_TRANSFER_SERIAL_MISMATCH` | 400 | 「序列号数量与调拨数量不一致或重复」 |
| `INVENTORY_TRANSFER_SEQUENCE_MISSING` | 500 | 「调拨单号序列未配置（系统配置错误）」 |
| `STOCK_COUNT_SNAPSHOT_MISSING` | 400 | 「盘点行缺少冻结快照（账面数/盘点时间），无法完成盘点」 |
| `STOCK_COUNT_ALREADY_COMPLETED` | 409 | 「盘点已完成（幂等响应）」 |
| `STOCK_COUNT_CANCELLED` | 409 | 「盘点单已取消，无法完成」 |
| `INVENTORY_ADJUSTMENT_MAKER_CHECKER` | 409 | 「Apply 人不能与创建人相同（制单/复核分离）」 |
| `INVENTORY_ADJUSTMENT_SOURCE_LINE_ALREADY_SETTLED` | 409 | 「该盘点行差异已被其他调整单结算」 |
| `INVENTORY_ADJUSTMENT_ALREADY_APPLIED` | 409 | 「调整单已过账，不可重复 Apply」 |
| `INVENTORY_CONVERSION_BASE_QTY_INVALID` | 400 | 「转换数量与系统计算的基准数量不一致，请刷新后重试」 |
| `INVENTORY_CONVERSION_BASE_QTY_MISMATCH` | 400 | 「消耗与产出的基准数量不一致（守恒校验失败）」 |
| `INVENTORY_CONVERSION_BASE_UOM_INVALID` | 400 | 「基准单位与该物料的库存单位不一致」 |
| `INVENTORY_CONVERSION_BATCH_MISMATCH` | 400 | 「消耗与产出的批次必须一致」 |
| `INVENTORY_CONVERSION_ALREADY_EXECUTED` | 409 | 「转换单已执行，重复执行已拒绝（幂等）」 |
| `INVENTORY_CONVERSION_SEQUENCE_MISSING` | 500 | 「转换单号序列未配置（系统配置错误）」 |
| `SEQUENCE_MISSING`（通用） | 500 | 「单号序列未配置（系统配置错误）」 |

---

## 3. UX 处置模式

| 场景 | 前端行为 |
| --- | --- |
| 表单校验失败 | 字段级内联提示（不弹全局） |
| 业务 409（状态冲突/幂等/超量） | 顶部 toast + 按钮保持可用（可刷新重试）；**终态幂等（ALREADY_EXECUTED/APPLIED）→ 提示"已处理"并刷新列表** |
| 版本冲突 409 | 专用提示「数据已更新，请刷新」+ 刷新按钮 |
| 403 权限 | 按钮隐藏（按钮级）；页面级 → `<Forbidden />` |
| 500 配置错误（Sequence missing） | 提示「系统配置错误，请联系管理员」+ 记录错误码 |
| 网络异常 | 统一「网络异常，请重试」+ 重试按钮 |

---

## 4. 前端错误提示纪律（CTO 红线落实）

1. **提示文案一律映射 `ERROR_CODES`**（后端稳定码），前端不发明错误语义
2. **不吞错误**：即使按钮已按状态机隐藏，后端 409 仍作为最终防线展示（映射表可能滞后）
3. **幂等友好**：终态重复操作（EXECUTED/APPLIED/COMPLETED/RETURNED/POSTED）提示"已处理"而非报错
4. **Reservation / Costing 无前端入口**（HOLD 延续，不映射相关错误）
