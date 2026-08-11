# Frontend Operations Workspace — Module Map（前端工作台模块地图）

- 版本：v0.1（Track A 首批交付，CTO #8777 Post-6B Portfolio Gate）
- 分支：`feature/frontend-operations-workspace`（从 main @ `874e060` 创建）
- 日期：2026-08-11
- 维护者：CIO（JINZA）｜审核：CTO
- 状态：**IA / UX Flow / API Contract Mapping / Page Skeleton 阶段——不重写全页面**

> **红线（CTO #8777）**：① 首批只消费**已 FINAL 的后端契约**（5A/5B/6A/6B），**不反向改库存事实模型**；② Dashboard/Query 只允许 read-model 优化，**禁止前端自行计算"权威库存余额"**、**禁止绕过 API 组合事实**；③ Reservation / Costing 继续 HOLD（前端也不做）。

---

## 1. 模块地图总览

```
ERP Frontend（Next.js App Router，apps/web）
└── (dashboard) 工作台
    ├── 采购执行工作台（Track A 首批，消费 5A/5B FINAL 契约）
    │   ├── Purchase Requisition（采购申请）
    │   ├── Purchase Order（采购订单）
    │   ├── Purchase Receipt（到货收货）
    │   ├── Inspection（质检）
    │   ├── Warehouse Receipt（采购入库）
    │   └── Purchase Return（采购退货）
    ├── 库存工作台（Track A 首批，消费 6A/6B FINAL 契约）
    │   ├── Stock Projection（库存余额投影——**只读展示，不自行计算**）
    │   ├── Inventory Movement Ledger（库存流水——**只读展示**）
    │   ├── Inventory Transfer（调拨）
    │   ├── Stock Count（盘点）
    │   ├── Inventory Adjustment（库存调整）
    │   └── Conversion / Repack（转换/重包装）
    ├── 流程状态与权限（跨模块横切）
    │   ├── Approval / Workflow 状态展示
    │   ├── 状态机按钮显隐
    │   ├── RBAC 权限守卫
    │   ├── Audit trail（审计追溯入口）
    │   ├── 业务错误码映射
    │   └── 并发 / version conflict UI
    └── Dashboard / Query Read Model（只读优化）
```

---

## 2. 采购执行工作台（6 模块）

| 模块 | 后端契约（FINAL） | 关键动作 | 页面形态 |
| --- | --- | --- | --- |
| Purchase Requisition | 5A `api/purchase-requisitions` | list / create / PATCH / submit / convert | 列表 + 详情 + 创建表单骨架 |
| Purchase Order | 5A `api/purchase-orders` | list / create / PATCH / submit / confirm / cancel | 列表 + 详情 + 创建表单骨架 |
| Purchase Receipt | 5B `api/purchase-receipts` | list / create / PATCH / receive / cancel | 列表 + 详情 + 收货动作骨架 |
| Inspection | 5B `api/inspections` | list / create / PATCH / complete | 列表 + 详情 + 质检动作骨架 |
| Warehouse Receipt | 5B `api/warehouse-receipts` | list / create / PATCH / post | 列表 + 详情 + 过账动作骨架 |
| Purchase Return | 5B `api/purchase-returns` | list / create / PATCH / return | 列表 + 详情 + 退货动作骨架 |

## 3. 库存工作台（6 模块）

| 模块 | 后端契约（FINAL） | 关键动作 | 页面形态 |
| --- | --- | --- | --- |
| Stock Projection | 6A（只读查询） | 五维余额展示（item/warehouse/location/batch/serial） | **只读列表**（余额来自后端，前端不计算） |
| Inventory Movement Ledger | 6A `api/inventory-ledger`（只读） | 流水追溯 | **只读列表** + 详情 |
| Inventory Transfer | 6B `api/inventory-transfers` | list / create / PATCH / submit / **execute** / cancel | 列表 + 详情 + 执行动作骨架 |
| Stock Count | 6B `api/stock-counts` | list / create / PATCH / lines / **complete** / cancel | 列表 + 详情 + 盘点录入骨架 |
| Inventory Adjustment | 6B `api/inventory-adjustments` | list / create / PATCH / submit / **apply** / cancel | 列表 + 详情 + 过账动作骨架 |
| Conversion / Repack | 6B `api/inventory-conversions` | list / create / PATCH / submit / **execute** / cancel | 列表 + 详情 + 执行动作骨架 |

---

## 4. 横切能力（流程状态与权限）

| 能力 | 设计原则 | 后端契约 |
| --- | --- | --- |
| Approval / Workflow 状态 | 展示单据 `status` + 关联 Workflow 实例状态；**前端不驱动审批逻辑**（只展示 + 触发 action API） | `api/workflows/instances`（只读展示） |
| 状态机按钮显隐 | 按单据 status 决定可操作按钮（如 DRAFT→submit、SUBMITTED→approve/execute）；**状态机规则以 OpenAPI 为准，前端硬编码映射表**（不发明规则） | OpenAPI 各端点 |
| RBAC | `PermissionGuard` + 后端权限码；页面级守卫 + 按钮级权限（对齐 6B 模式） | `packages/shared` PERMISSIONS（Track A 扩展采购/库存模块） |
| Audit trail | 详情页提供审计入口（跳转 audit-logs 或嵌入只读列表） | `api/audit-logs`（只读） |
| 业务错误码映射 | 后端稳定错误码（如 `INVENTORY_TRANSFER_ALREADY_EXECUTED`）→ 前端中文提示映射表；**不吞错误，409/400/403 区分展示** | `lib/api/errors.ts` ERROR_CODES |
| 并发 / version conflict UI | 所有变更请求携带 `version`（乐观锁）；409 VERSION_CONFLICT → 提示"数据已更新，请刷新" | 各 PATCH/action 请求体 |

---

## 5. Dashboard / Query Read Model（只读优化）

- **只允许**：后端已有 read-model / 聚合 API 的消费（如 dashboard KPI、单据列表查询参数）
- **禁止**：前端自行计算"权威库存余额"（Stock Projection 余额只能来自 6A 后端）；禁止前端内存中组合多 API 结果伪造余额/差异
- 库存相关 Dashboard 卡片（如有）一律走后端聚合端点，前端只渲染

---

## 6. 本阶段交付边界（Page Skeleton 阶段）

1. 每个模块一个**骨架页**（`PlaceholderPage` 模式：标题 + 描述 + 权限守卫），**不实现完整 CRUD UI**
2. 5 份规划文档（本文件 + Page/Route map + API Contract map + State/Action matrix + Error/Permission UX matrix）
3. 不写后端代码；不改库存事实模型；不开 Reservation/Costing
4. 后续迭代（经 CTO 批准）再逐个模块做真实列表/表单
