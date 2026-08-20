# A-4 原子乐观锁 CAS QA（PR #116-#121）

- **日期：** 2026-08-20
- **范围：** 30 个 PATCH/事务路由 read-check-update TOCTOU → 原子 CAS（casUpdate）；已内建 CAS / FOR UPDATE 路由核实
- **验证策略：** CI-First——Quality Gates（lint/type-check/unit）+ Build + Secret Scanning 全绿合入

## 静态验收清单

| # | 检查项 | 结果 |
| --- | --- | --- |
| S1 | 批次 1-6 共 30 路由转换（customers×3/files/deliveries×2/approver-groups/suppliers×4/menus/menu-groups/settings/workflows/items-supplier/quotations×2/sales-orders×2/invoices/projects×11） | ✅ |
| S2 | casUpdate(updateMany where {id,version,deletedAt:null} + count===0 → CONFLICT/NOT_FOUND) 统一使用 | ✅ |
| S3 | 事务型 CAS 置于事务首部（先 CAS 后 Revision/行替换/审批触发/重算，失败零副作用） | ✅ |
| S4 | 嵌套子资源保留归属校验（customerId/projectId/itemId 等 prefetch） | ✅ |
| S5 | 行删除竞态区分 404/409（stillExists 复核） | ✅ |
| S6 | 哨兵/抛出错误映射（含 WORKFLOW 回滚语义保留） | ✅ |
| S7 | 已内建 CAS 核实跳过：purchase-requisitions/orders/receipts/returns、warehouse-receipts、stock-counts/[id]、inspections | ✅ |
| S8 | FOR UPDATE 动作路由核实跳过：inventory-* submit/cancel/execute/apply、supplier-invoices、stock-counts cancel/complete、deliveries lines 锁源行 | ✅ |
| S9 | 全仓无遗留 PATCH TOCTOU（version !== version 仅存于已安全路由） | ✅ |

## Known Risk

1. 版本冲突/并发语义需人工接口验证（无 E2E）。
2. 审计 beforeData 仍用事务外 prefetch（best-effort 历史快照）。