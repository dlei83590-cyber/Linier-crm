# Frontend Operations Workspace — State / Action Matrix（状态与动作矩阵）

- 版本：v0.1（Track A 首批交付，CTO #8777 Post-6B Portfolio Gate）
- 分支：`feature/frontend-operations-workspace`（从 main @ `874e060` 创建）
- 日期：2026-08-11
- 状态：**Page Skeleton 阶段——矩阵供后续迭代按钮显隐/状态展示使用，骨架页不实现**

> **原则（CTO 红线）**：状态机规则以 OpenAPI / 后端为准（FINAL 契约），前端只做**映射表**（硬编码），**不发明规则**；`version` 乐观锁全部携带；终态后动作禁显（按钮灰化 + 后端 409 兜底）。

---

## 1. 采购执行工作台（5A/5B FINAL 契约状态机）

### 1.1 Purchase Requisition（采购申请）

| 状态 | 可操作按钮 | 禁显/禁用 | 说明 |
| --- | --- | --- | --- |
| DRAFT | 编辑 / 提交 / 删除 | — | 创建即取号 |
| SUBMITTED | 查看 / 审批流转（Workflow 页） | 编辑 / 提交 | 待审批 |
| APPROVED | 转采购订单（convert） | 编辑 | convert 唯一出口 |
| REJECTED / CANCELLED | 查看 | 一切变更 | 终态 |

### 1.2 Purchase Order（采购订单）

| 状态 | 可操作按钮 | 禁显/禁用 | 说明 |
| --- | --- | --- | --- |
| DRAFT | 编辑 / 提交 / 取消 | — | Direct/Convert 双入口 |
| SUBMITTED | 查看 / Withdraw（如支持） | 编辑 / 提交 | 待审批 |
| APPROVED | **确认（confirm）** / 取消 | 编辑 / 提交 | **APPROVED ≠ CONFIRMED**（红线） |
| CONFIRMED | 查看 / 等待收货 | confirm 禁 | Confirm 后进入 5B 收货链 |
| PARTIALLY_RECEIVED | 查看 / 继续收货（5B 页） | — | 收货投影驱动 |
| RECEIVED | 查看 | 普通新增收货禁（5B D9） | 终态 |
| CANCELLED | 查看 | 一切变更 | 终态 |

### 1.3 Purchase Receipt（到货收货）

| 状态 | 可操作按钮 | 禁显/禁用 | 说明 |
| --- | --- | --- | --- |
| DRAFT | 编辑 / 收货（receive）/ 取消 | — | 只有 CONFIRMED/部分收货 PO 可收 |
| RECEIVED | 查看（可去质检/入库） | 编辑 / 收货 | 收货现场事实已定 |
| CANCELLED | 查看 | 一切变更 | 终态 |

### 1.4 Inspection（质检）

| 状态 | 可操作按钮 | 禁显/禁用 | 说明 |
| --- | --- | --- | --- |
| DRAFT | 编辑 / 完成（complete）/ 取消 | — | SKIP/SPOT/FULL |
| COMPLETED | 查看（可去入库） | 编辑 / 完成 | qualifiedQty + rejectedQty = inspectableQty 强制 |
| CANCELLED | 查看 | 一切变更 | 终态 |

### 1.5 Warehouse Receipt（采购入库）

| 状态 | 可操作按钮 | 禁显/禁用 | 说明 |
| --- | --- | --- | --- |
| DRAFT | 编辑 / 过账（post）/ 取消 | — | Created ≠ Posted |
| POSTED | 查看（库存已入账） | 编辑 / 过账 | **Posted 触发 6A InventoryMovement(IN)**；终态证据 postedAt/postedById |
| CANCELLED | 查看 | 一切变更 | 终态 |

### 1.6 Purchase Return（采购退货）

| 状态 | 可操作按钮 | 禁显/禁用 | 说明 |
| --- | --- | --- | --- |
| DRAFT | 编辑 / 退货（return）/ 取消 | — | 来源可退余额 Gate |
| RETURNED | 查看 | 编辑 / 退货 | 已退；REPLACE_REQUIRED 重开 PO 履约 |
| CANCELLED | 查看 | 一切变更 | 终态 |

---

## 2. 库存工作台（6A/6B FINAL 契约状态机）

### 2.1 Inventory Transfer（调拨）

| 状态 | 可操作按钮 | 禁显/禁用 | 说明 |
| --- | --- | --- | --- |
| DRAFT | 编辑 / 提交 / 取消 | — | 创建即取号 TRF |
| SUBMITTED | 查看 / 取消 | 编辑 | 无审批状态机？——Transfer 走 Workflow（有 APPROVED） |
| APPROVED | **执行（execute）** / 取消 | 编辑 / 提交 | execute 前可取消 |
| EXECUTED | 查看（双边 Movement） | **取消禁**（纠错走 Reversal） | 终态证据 movementGroupId/executedAt/executedById；重试幂等 |
| CANCELLED | 查看 | 一切变更 | 终态 |

### 2.2 Stock Count（盘点）

| 状态 | 可操作按钮 | 禁显/禁用 | 说明 |
| --- | --- | --- | --- |
| DRAFT | 编辑 / 录入行（lines）/ 完成（complete）/ 取消 | — | 创建即取号 CNT |
| COUNTING | 录入行 / 完成 / 取消 | 编辑头 | 行录入冻结 bookQtyAtCount/varianceQty |
| COMPLETED | 查看（零差异）/ 查看差异单 | 编辑 / 录入 / 完成 | **Complete 不直写库存账**；事件一次性 |
| ADJUSTED | 查看（差异已转 Adjustment） | 取消禁 | 终态（幂等响应 ok + idempotent） |
| CANCELLED | 查看 | 一切变更 | 终态 |

### 2.3 Inventory Adjustment（库存调整）

| 状态 | 可操作按钮 | 禁显/禁用 | 说明 |
| --- | --- | --- | --- |
| DRAFT | 编辑 / 提交 / 取消 | — | 创建即取号 ADJ |
| SUBMITTED | 查看 / 取消 | 编辑 | 待审批 |
| APPROVED | **Apply** / 取消 | 编辑 / 提交 | **maker-checker：apply 人 ≠ 创建人**（409 MAKER_CHECKER） |
| APPLIED | 查看（ADJUSTMENT Movement） | **取消禁** | 终态证据 approvedById/appliedById/appliedAt；Apply 唯一落账入口 |
| CANCELLED | 查看 | 一切变更 | 终态 |

### 2.4 Inventory Conversion / Repack（转换/重包装）

| 状态 | 可操作按钮 | 禁显/禁用 | 说明 |
| --- | --- | --- | --- |
| DRAFT | 编辑 / 提交 / 取消 | — | 创建即取号 CVT；baseUom==stockUom Gate |
| SUBMITTED | **执行（execute）** / 取消 | 编辑 | **无审批状态机**（计量事实不发明审批流） |
| EXECUTED | 查看（CONSUME+PRODUCE Movement） | **取消禁**（纠错走 Reversal） | 终态证据；逐行 canonical 重验 + 守恒 |
| CANCELLED | 查看 | 一切变更 | 终态 |

---

## 3. 横切动作映射（通用）

| 动作 | 权限码（Track A 扩展前端常量） | 请求体 | 说明 |
| --- | --- | --- | --- |
| view（列表/详情） | `{module}:view` | — | 页面守卫 |
| create | `{module}:create` | POST 体（无 version，创建即取号） | 表单提交 |
| edit（PATCH） | `{module}:edit` | `{ ..., version }` | CAS 乐观锁 |
| submit | `{module}:edit` | `{ version }` | 状态推进 |
| execute / post / apply / complete / receive / return / confirm | `{module}:edit`（apply 除外） | `{ version }` | 终态动作 |
| apply（Adjustment） | `inventory-adjustment:apply`（**受限系统权限**，仅 SUPER_ADMIN/ADMIN） | `{ version }` | maker-checker |
| cancel | `{module}:close` | `{ version }` | 取消 |

> **按钮显隐规则**：前端按"当前状态 × 动作"映射表渲染按钮；后端 409（INVALID_STATE/ALREADY_EXECUTED/APPLIED）仍为最终防线（前端映射表可能滞后，以后端为准展示错误提示）。
