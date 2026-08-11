# Frontend Operations Workspace — API Contract Map（前端消费契约映射）

- 版本：v0.1（Track A 首批交付，CTO #8777 Post-6B Portfolio Gate）
- 分支：`feature/frontend-operations-workspace`（从 main @ `874e060` 创建）
- 日期：2026-08-11
- 状态：**Page Skeleton 阶段——只映射契约，不实现真实调用**

> **红线（CTO #8777）**：前端只消费**已 FINAL 的后端契约**（5A/5B/6A/6B，全部已 merge main @ `874e060`）；**禁止绕过 API 组合事实**（如前端自己加库存余额）；**禁止反向改库存事实模型**。本表为骨架页/后续迭代的 API 消费地图。

---

## 1. 采购执行工作台（5A/5B FINAL 契约）

### 1.1 Purchase Requisition（采购申请，5A）

| 端点 | 方法 | 用途 | 骨架页消费 |
| --- | --- | --- | --- |
| `/api/purchase-requisitions` | GET | 列表（分页/筛选） | 列表页 |
| `/api/purchase-requisitions` | POST | 创建（创建即取号） | 创建表单 |
| `/api/purchase-requisitions/{id}` | GET | 详情 | 详情页 |
| `/api/purchase-requisitions/{id}` | PATCH | 编辑（仅 DRAFT，CAS version） | 编辑表单 |
| `/api/purchase-requisitions/{id}/submit` | POST | 提交（DRAFT→SUBMITTED→Workflow） | 动作按钮 |
| `/api/purchase-requisitions/{id}/convert` | POST | 转采购订单 | 动作按钮 |

### 1.2 Purchase Order（采购订单，5A）

| 端点 | 方法 | 用途 | 骨架页消费 |
| --- | --- | --- | --- |
| `/api/purchase-orders` | GET | 列表 | 列表页 |
| `/api/purchase-orders` | POST | 创建（Direct/Convert 双入口） | 创建表单 |
| `/api/purchase-orders/{id}` | GET | 详情 | 详情页 |
| `/api/purchase-orders/{id}` | PATCH | 编辑（仅 DRAFT，CAS） | 编辑表单 |
| `/api/purchase-orders/{id}/submit` | POST | 提交 | 动作按钮 |
| `/api/purchase-orders/{id}/confirm` | POST | 确认（**APPROVED ≠ CONFIRMED**，Confirm 后进入收货链） | 动作按钮 |
| `/api/purchase-orders/{id}/cancel` | POST | 取消（DRAFT/APPROVED 可取消） | 动作按钮 |

### 1.3 Purchase Receipt（到货收货，5B）

| 端点 | 方法 | 用途 | 骨架页消费 |
| --- | --- | --- | --- |
| `/api/purchase-receipts` | GET | 列表 | 列表页 |
| `/api/purchase-receipts` | POST | 创建 | 创建表单 |
| `/api/purchase-receipts/{id}` | GET | 详情 | 详情页 |
| `/api/purchase-receipts/{id}` | PATCH | 编辑（仅 DRAFT，CAS） | 编辑表单 |
| `/api/purchase-receipts/{id}/receive` | POST | 收货（CONFIRMED PO 来源 Gate） | 动作按钮 |
| `/api/purchase-receipts/{id}/cancel` | POST | 取消 | 动作按钮 |

### 1.4 Inspection（质检，5B）

| 端点 | 方法 | 用途 | 骨架页消费 |
| --- | --- | --- | --- |
| `/api/inspections` | GET | 列表 | 列表页 |
| `/api/inspections` | POST | 创建 | 创建表单 |
| `/api/inspections/{id}` | GET | 详情 | 详情页 |
| `/api/inspections/{id}` | PATCH | 编辑（仅 DRAFT，CAS） | 编辑表单 |
| `/api/inspections/{id}/complete` | POST | 完成（qualifiedQty + rejectedQty = inspectableQty 强制） | 动作按钮 |

### 1.5 Warehouse Receipt（采购入库，5B）

| 端点 | 方法 | 用途 | 骨架页消费 |
| --- | --- | --- | --- |
| `/api/warehouse-receipts` | GET | 列表 | 列表页 |
| `/api/warehouse-receipts` | POST | 创建 | 创建表单 |
| `/api/warehouse-receipts/{id}` | GET | 详情 | 详情页 |
| `/api/warehouse-receipts/{id}` | PATCH | 编辑（仅 DRAFT，CAS） | 编辑表单 |
| `/api/warehouse-receipts/{id}/post` | POST | **过账（Posted 触发 6A InventoryMovement(IN)）** | 动作按钮 |

### 1.6 Purchase Return（采购退货，5B）

| 端点 | 方法 | 用途 | 骨架页消费 |
| --- | --- | --- | --- |
| `/api/purchase-returns` | GET | 列表 | 列表页 |
| `/api/purchase-returns` | POST | 创建（来源可退余额 Gate） | 创建表单 |
| `/api/purchase-returns/{id}` | GET | 详情 | 详情页 |
| `/api/purchase-returns/{id}` | PATCH | 编辑（仅 DRAFT，CAS） | 编辑表单 |
| `/api/purchase-returns/{id}/return` | POST | 退货（REPLACE_REQUIRED 重开 PO 履约） | 动作按钮 |

---

## 2. 库存工作台（6A/6B FINAL 契约）

### 2.1 Stock Projection（库存余额投影，6A）——**只读**

| 端点 | 方法 | 用途 | 骨架页消费 |
| --- | --- | --- | --- |
| 五维余额查询端点（6A 只读 read-model） | GET | 余额展示（item/warehouse/location/batch/serial） | **只读列表（余额全部来自后端，前端零计算）** |

### 2.2 Inventory Movement Ledger（库存流水，6A）——**只读**

| 端点 | 方法 | 用途 | 骨架页消费 |
| --- | --- | --- | --- |
| `/api/inventory-ledger/consume` | POST | 触发 Consumer（后台动作，**前端不调用**） | — |
| 流水查询端点（6A 只读） | GET | 追溯 InventoryMovement（不可变账本） | **只读列表 + 详情** |

### 2.3 Inventory Transfer（调拨，6B）

| 端点 | 方法 | 用途 | 骨架页消费 |
| --- | --- | --- | --- |
| `/api/inventory-transfers` | GET | 列表 | 列表页 |
| `/api/inventory-transfers` | POST | 创建（创建即取号 TRF） | 创建表单 |
| `/api/inventory-transfers/{id}` | GET | 详情 | 详情页 |
| `/api/inventory-transfers/{id}` | PATCH | 编辑（仅 DRAFT，CAS） | 编辑表单 |
| `/api/inventory-transfers/{id}/submit` | POST | 提交 | 动作按钮 |
| `/api/inventory-transfers/{id}/execute` | POST | **执行（SOURCE_OUT + DESTINATION_IN 同事务）** | 动作按钮（EXECUTED 后禁 Cancel） |
| `/api/inventory-transfers/{id}/cancel` | POST | 取消（DRAFT/APPROVED 可取消） | 动作按钮 |

### 2.4 Stock Count（盘点，6B）

| 端点 | 方法 | 用途 | 骨架页消费 |
| --- | --- | --- | --- |
| `/api/stock-counts` | GET | 列表 | 列表页 |
| `/api/stock-counts` | POST | 创建（创建即取号 CNT） | 创建表单 |
| `/api/stock-counts/{id}` | GET | 详情 | 详情页 |
| `/api/stock-counts/{id}` | PATCH | 编辑（仅 DRAFT，CAS） | 编辑表单 |
| `/api/stock-counts/{id}/lines` | POST | **行录入（冻结 bookQtyAtCount/varianceQty）** | 盘点录入骨架 |
| `/api/stock-counts/{id}/complete` | POST | **完成（FOR UPDATE 幂等；差异自动生成 Adjustment）** | 动作按钮 |
| `/api/stock-counts/{id}/cancel` | POST | 取消（COMPLETED/ADJUSTED 禁） | 动作按钮 |

### 2.5 Inventory Adjustment（库存调整，6B）

| 端点 | 方法 | 用途 | 骨架页消费 |
| --- | --- | --- | --- |
| `/api/inventory-adjustments` | GET | 列表 | 列表页 |
| `/api/inventory-adjustments` | POST | 创建（创建即取号 ADJ；来源一致性 Gate） | 创建表单 |
| `/api/inventory-adjustments/{id}` | GET | 详情 | 详情页 |
| `/api/inventory-adjustments/{id}` | PATCH | 编辑（仅 DRAFT，CAS） | 编辑表单 |
| `/api/inventory-adjustments/{id}/submit` | POST | 提交 | 动作按钮 |
| `/api/inventory-adjustments/{id}/apply` | POST | **Apply（maker-checker：apply 人 ≠ 创建人；ADJUSTMENT Movement 落账）** | 动作按钮（受限权限 `inventory-adjustment:apply`） |
| `/api/inventory-adjustments/{id}/cancel` | POST | 取消（APPLIED 禁） | 动作按钮 |

### 2.6 Inventory Conversion / Repack（转换/重包装，6B）

| 端点 | 方法 | 用途 | 骨架页消费 |
| --- | --- | --- | --- |
| `/api/inventory-conversions` | GET | 列表 | 列表页 |
| `/api/inventory-conversions` | POST | 创建（创建即取号 CVT；baseUom==stockUom Gate；baseQuantity 服务端计算） | 创建表单 |
| `/api/inventory-conversions/{id}` | GET | 详情 | 详情页 |
| `/api/inventory-conversions/{id}` | PATCH | 编辑（仅 DRAFT，CAS；itemId/baseUomId 不可编辑） | 编辑表单 |
| `/api/inventory-conversions/{id}/submit` | POST | 提交（无审批状态机） | 动作按钮 |
| `/api/inventory-conversions/{id}/execute` | POST | **Execute（逐行 canonical 重验 + 守恒 + Shared Core 落账）** | 动作按钮（EXECUTED 后禁 Cancel） |
| `/api/inventory-conversions/{id}/cancel` | POST | 取消（EXECUTED 禁） | 动作按钮 |

---

## 3. 横切契约

| 能力 | 端点/契约 | 说明 |
| --- | --- | --- |
| RBAC | `packages/shared` `PERMISSIONS` + `hasPermission` | Track A 扩展采购/库存模块 READ key（纯前端常量，对齐后端权限码） |
| Workflow 状态展示 | `/api/workflows/instances`（只读） | 前端只展示单据状态 + 关联流程状态，不驱动审批 |
| Audit trail | `/api/audit-logs`（只读） | 详情页提供审计入口 |
| 错误码 | `lib/api/errors.ts` `ERROR_CODES`（后端稳定错误码） | 前端映射中文提示（见 Error/Permission UX Matrix） |
| 乐观锁 | 所有 PATCH/action 请求体携带 `version` | 409 VERSION_CONFLICT → 刷新提示 |

---

## 4. 契约映射纪律（CTO #8777 红线落实）

1. **前端不自行计算"权威库存余额"**：Stock Projection 余额只来自后端；前端不把多条流水相加
2. **不绕过 API 组合事实**：页面数据一律来自单一后端端点（或后端已聚合的 read-model），前端不做跨端点内存拼接伪造业务事实
3. **不反向改库存事实模型**：本分支只加 `apps/web/src/app/(dashboard)/purchasing|inventory/*` 骨架页 + `docs/frontend/*` 规划文档 + `PERMISSIONS` 前端常量；**零后端代码改动**
4. **Reservation / Costing 不做前端入口**（HOLD 延续）
