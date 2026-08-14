# Frontend Contract Cards — 前端契约卡（F2-1 UI System Foundation）

- 状态：F2-1 Wave 0 交付（2026-08-14）
- 用途：每个业务模块唯一的「前端开发就绪度」事实卡片。
  禁止再靠人工记忆"这个模块做到哪一步"；卡片与 Module Registry 的
  `capabilities`（apps/web/src/lib/frontend/modules.ts）保持一致。

## 判定规则（每个模块只允许一种）

| 判定       | 条件                                                | 动作                                                    |
| ---------- | --------------------------------------------------- | ------------------------------------------------------- |
| **可开发** | Backend FINAL + Frontend Missing（占位页）          | 按 Wave 计划实现 List→Detail→Create/Edit                |
| **迁移**   | Backend FINAL + Frontend Existing（成熟页面）       | 接入统一 Workspace / Registry，保留业务逻辑，不推倒重写 |
| **HOLD**   | Backend Contract Missing（无 FINAL read/write API） | 不开放任何操作；导航显示"尚未开放"                      |

## 双层能力语义（CTO F2-1 Review 94/100 修正）

每张卡片与 Module Registry 一样区分两层，**禁止合并判断**：

- **Backend Contract**：后端 FINAL contract 是否存在（按 `apps/web/src/app/api` 实际路由核验）——回答"后端能做什么"
- **Current Frontend（ui）**：当前 main 上 Frontend 真正开放了什么（按 `apps/web/src/app/(dashboard)` 实际页面核验）——**唯一允许 Sidebar / Dashboard / Workspace / action rendering 消费的层**

铁律：

1. Tier 2 workflow / Tier 3 factActions → ui 一律 false（HARD HOLD）
2. PR #38 未入 main 的 PO / Receipt / WHR Create/Edit → ui create/edit false
3. 只有当前 main 实际已有页面才能 ui=true（占位页不算开放）
4. HOLD 模块即使 backend contract 完整，ui 仍可全 false

## 总索引（2026-08-14 核验，API 事实来自 apps/web/src/app/api 实际路由）

### 可开发（Backend FINAL + Frontend Missing）

| 模块                               | 卡片                                                   | 归属 Wave                |
| ---------------------------------- | ------------------------------------------------------ | ------------------------ |
| 物料管理 items                     | [items.md](./items.md)                                 | F2-2 Wave 1              |
| 价格表 price-lists                 | [price-lists.md](./price-lists.md)                     | F2-2 Wave 1              |
| 计量单位 unit-of-measures          | [unit-of-measures.md](./unit-of-measures.md)           | F2-2 Wave 1（list only） |
| 仓库 warehouses                    | [warehouses.md](./warehouses.md)                       | F2-2 Wave 1（list only） |
| 库位 warehouse-locations           | [warehouse-locations.md](./warehouse-locations.md)     | F2-2 Wave 1（list only） |
| 项目机会 project-opportunities     | [project-opportunities.md](./project-opportunities.md) | F2-4                     |
| 项目管理 projects                  | [projects.md](./projects.md)                           | F2-4                     |
| 报价单 quotations                  | [quotations.md](./quotations.md)                       | F2-5                     |
| 销售订单 sales-orders              | [sales-orders.md](./sales-orders.md)                   | F2-5                     |
| 送货单 deliveries                  | [deliveries.md](./deliveries.md)                       | F2-5                     |
| 销售发票 sales-invoices            | [sales-invoices.md](./sales-invoices.md)               | F2-5                     |
| 应收账款 accounts-receivable       | [accounts-receivable.md](./accounts-receivable.md)     | F2-5（只读）             |
| 收款核销 receipt-allocation        | [receipt-allocation.md](./receipt-allocation.md)       | F2-5                     |
| 贷项/借项通知单 credit-debit-notes | [credit-debit-notes.md](./credit-debit-notes.md)       | F2-5                     |
| 供应商发票 supplier-invoices       | [supplier-invoices.md](./supplier-invoices.md)         | F2-6                     |
| 操作日志 audit-logs                | [audit-logs.md](./audit-logs.md)                       | 未排期                   |

### 迁移（Backend FINAL + Frontend Existing → 接入统一层）

| 模块                           | 卡片                                                   | 归属 Wave |
| ------------------------------ | ------------------------------------------------------ | --------- |
| 采购申请 purchase-requisitions | [purchase-requisitions.md](./purchase-requisitions.md) | F2-3      |
| 采购订单 purchase-orders       | [purchase-orders.md](./purchase-orders.md)             | F2-3      |
| 到货收货 purchase-receipts     | [purchase-receipts.md](./purchase-receipts.md)         | F2-3      |
| 质检记录 inspections           | [inspections.md](./inspections.md)                     | F2-3      |
| 仓库收货 warehouse-receipts    | [warehouse-receipts.md](./warehouse-receipts.md)       | F2-3      |
| 采购退货 purchase-returns      | [purchase-returns.md](./purchase-returns.md)           | F2-3      |
| 库存调拨 inventory-transfers   | [inventory-transfers.md](./inventory-transfers.md)     | F2-3      |
| 库存盘点 stock-counts          | [stock-counts.md](./stock-counts.md)                   | F2-3      |
| 库存调整 inventory-adjustments | [inventory-adjustments.md](./inventory-adjustments.md) | F2-3      |
| 库存转换 inventory-conversions | [inventory-conversions.md](./inventory-conversions.md) | F2-3      |

### HOLD（Backend Contract Missing / 未开放）

见 [HOLD.md](./HOLD.md)：business-partners、technical-standards、commercial-terms、
document-sequences、users、departments、roles、project-visits、project-risks、
stock-projection、inventory-ledger、ap-open-items、supplier-cn-dn、payment-allocation、reports。

## 维护规则

1. 每个 Wave 开始前：复核对应模块卡片（API / 状态机 / 错误码是否与后端一致）
2. 后端契约变更（新增/删除端点）→ 同步更新卡片 Backend Contract + Registry `contract` 层
3. 前端页面变更（新增/删除页面）→ 同步更新卡片 Frontend Current State + Registry `ui` 层
4. 页面完成后：Current UI / Gap 两栏更新，判定从"可开发"流转为"迁移"或"Ready"
5. 卡片与代码冲突时：以 `apps/web/src/app/api`（contract）与 `apps/web/src/app/(dashboard)`（ui）实际事实为准，更新卡片
