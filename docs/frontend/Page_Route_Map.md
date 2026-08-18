# Frontend Operations Workspace — Page / Route Map（页面与路由地图）

- 版本：v0.1（Track A 首批交付，CTO #8777 Post-6B Portfolio Gate）
- 分支：`feature/frontend-operations-workspace`（从 main @ `874e060` 创建）
- 日期：2026-08-11
- 状态：**Page Skeleton 阶段——骨架页（PlaceholderPage 模式），不实现完整 CRUD UI**

> 路由采用 Next.js App Router 既有模式：`apps/web/src/app/(dashboard)/<segment>/page.tsx` + `PermissionGuard` + `PlaceholderPage`。骨架页只做 IA 占位 + 权限守卫，真实列表/表单在后续迭代（经 CTO 批准）逐个实现。
>
> **更新（2026-08-18，Pending Pages Completion Gate，ADR-0029）**：9 个 Placeholder 页面已全部替换——7 个真实 CRUD（business-partners / technical-standards / commercial-terms / document-sequences / users / departments / roles，列表 + 新建 + 编辑）+ 2 个引导页（project-visits / project-risks，CRUD 在项目详情 Tab）。详见 `docs/frontend/contract-cards/pending-pages-completion-gate.md`。

---

## 1. 路由总览（Track A 首批）

```
(dashboard)/
├── purchasing/                          # 采购执行工作台（消费 5A/5B FINAL 契约）
│   ├── requisitions/page.tsx            # 采购申请（Purchase Requisition）
│   ├── orders/page.tsx                  # 采购订单（Purchase Order）
│   ├── receipts/page.tsx                # 到货收货（Purchase Receipt）
│   ├── inspections/page.tsx             # 质检（Inspection）
│   ├── warehouse-receipts/page.tsx      # 采购入库（Warehouse Receipt）
│   └── returns/page.tsx                 # 采购退货（Purchase Return）
└── inventory/                           # 库存工作台（消费 6A/6B FINAL 契约）
    ├── stock-projection/page.tsx        # 库存余额投影（**只读展示，不自行计算**）
    ├── ledger/page.tsx                  # 库存流水（**只读展示**）
    ├── transfers/page.tsx               # 调拨（Inventory Transfer）
    ├── stock-counts/page.tsx            # 盘点（Stock Count）
    ├── adjustments/page.tsx             # 库存调整（Inventory Adjustment）
    └── conversions/page.tsx             # 转换/重包装（Conversion / Repack）
```

---

## 2. 页面明细（12 个骨架页）

| 路由 | 页面标题（骨架） | 权限守卫 | 页面描述（骨架文案） |
| --- | --- | --- | --- |
| `/purchasing/requisitions` | 采购申请 | `purchase-requisition:view` | 内部需求事实源（PR）；创建即取号，可转采购订单 |
| `/purchasing/orders` | 采购订单 | `purchase-order:view` | 采购承诺事实源（PO）；APPROVED ≠ CONFIRMED，Confirm 后进入收货链 |
| `/purchasing/receipts` | 到货收货 | `purchase-receipt:view` | 供应商送货事实；现场拒收/质检分离 |
| `/purchasing/inspections` | 质检 | `inspection:view` | 质量合格事实；SKIP/SPOT/FULL，qualifiedQty + rejectedQty = inspectableQty |
| `/purchasing/warehouse-receipts` | 采购入库 | `warehouse-receipt:view` | 采购入库事实；Posted 触发 6A InventoryMovement(IN) |
| `/purchasing/returns` | 采购退货 | `purchase-return:view` | 独立退货事实；来源可退余额 Gate，REPLACE_REQUIRED 重开 PO 履约 |
| `/inventory/stock-projection` | 库存余额投影 | `null`（⚠️ HOLD） | **QUERY CONTRACT GAP / HOLD（CTO #8845）**：无 FINAL Read API，仅 Placeholder，不接线 |
| `/inventory/ledger` | 库存流水 | `null`（⚠️ HOLD） | **QUERY CONTRACT GAP / HOLD（CTO #8845）**：无 FINAL 只读端点，仅 Placeholder，不接线 |
| `/inventory/transfers` | 库存调拨 | `inventory-transfer:view` | 双边原子事实（SOURCE_OUT + DESTINATION_IN 同一 movementGroupId） |
| `/inventory/stock-counts` | 库存盘点 | `stock-count:view` | 实盘事实；行录入冻结 bookQtyAtCount/varianceQty，Complete 不直写库存账 |
| `/inventory/adjustments` | 库存调整 | `inventory-adjustment:view` | 受控库存账事实；maker-checker（apply 人 ≠ 创建人）；Apply 唯一落账入口 |
| `/inventory/conversions` | 转换/重包装 | `inventory-conversion:view` | 同 item Repack/UOM Conversion；baseQuantity 服务端 canonical，守恒强制 |

---

## 3. 页面骨架模板（统一模式）

```tsx
"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.PURCHASE_ORDER_READ}>
      <PlaceholderPage title="采购订单" description="采购承诺事实源（PO）；APPROVED ≠ CONFIRMED。" />
    </PermissionGuard>
  );
}
```

> 骨架页统一使用现有 `PlaceholderPage` + `PermissionGuard` 模式（对齐 items/projects 页面先例），**不新增 UI 组件、不写后端调用**——Page Skeleton 阶段只确立 IA 与路由骨架。
> ✅ **CTO #8845 Contract Blocking 解除（Inventory Read Model Gate FINAL，2026-08-18）**：`/inventory/stock-projection`（`stock-projection:view`）与 `/inventory/ledger`（`inventory-movement:view`）已接入 FINAL 只读 API（`/api/stock-projections` + `/api/inventory-movements`），由 Placeholder 替换为真实列表/详情页；余额唯一权威 = 后端 StockProjection SSOT，前端不计算（§14/§16）。

---

## 4. 后续迭代计划（经 CTO 批准后）

1. **迭代 1（列表页）**：每模块真实列表（分页/筛选/状态列/按钮显隐）——消费 OpenAPI list 端点
2. **迭代 2（详情/表单页）**：创建/编辑表单 + 动作按钮（submit/confirm/execute/apply/complete/post/return）
3. **迭代 3（横切）**：Workflow 状态展示、Audit trail 入口、错误码映射提示、version conflict 刷新提示
4. **迭代 4（Dashboard）**：只读 read-model 卡片（余额/待办/差异），禁止前端算余额

> **红线保持**：不反向改库存事实模型；不绕过 API 组合事实；Reservation/Costing 不做前端入口。
