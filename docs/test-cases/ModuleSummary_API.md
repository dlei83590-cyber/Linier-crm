# Module Summary API 测试用例（模块页仪表盘 KPI）

> 版本：v1 ｜ 日期：2026-08-24 ｜ 关联：用户指令「所有功能页面增加该页面的仪表盘」
> 契约：`GET /api/<module>/summary`（只读聚合，每业务单据模块一个）

## 1. 契约

请求：`GET /api/<module>/summary`（Bearer 认证；权限 = 对应模块 `<module>:view`）

响应（`{ success: true, data }`）：

```json
{
  "total": 12,
  "byStatus": { "DRAFT": 3, "CONFIRMED": 9 },
  "amount": { "label": "订单金额", "value": "12345.6700" }
}
```

- `total`：未删除单据总数（`deletedAt: null`）
- `byStatus`：按状态枚举 GROUP BY 计数（key = 真实 enum 值；Supplier Invoice 用 `documentStatus`；Inspection 用 `result`）
- `amount`：可选（仅单据头含金额字段的模块）；value 为 **Decimal 字符串**（禁止 toNumber）

## 2. 覆盖模块（20 个）

| 模块 | summary 路由 | 状态字段 | 金额字段 |
|---|---|---|---|
| 报价单 | /api/quotations/summary | status | totalAmount（报价金额） |
| 销售订单 | /api/sales-orders/summary | status | totalAmount（订单金额） |
| 送货单 | /api/deliveries/summary | status | — |
| 销售发票 | /api/invoices/summary | status | invoiceTotal（发票金额） |
| 采购申请 | /api/purchase-requisitions/summary | status | — |
| 采购订单 | /api/purchase-orders/summary | status | totalAmount（订单金额） |
| 到货收货 | /api/purchase-receipts/summary | status | — |
| 质检记录 | /api/inspections/summary | result | — |
| 仓库收货 | /api/warehouse-receipts/summary | status | — |
| 采购退货 | /api/purchase-returns/summary | status | — |
| 库存调拨 | /api/inventory-transfers/summary | status | — |
| 库存盘点 | /api/stock-counts/summary | status | — |
| 库存调整 | /api/inventory-adjustments/summary | status | — |
| 库存转换 | /api/inventory-conversions/summary | status | — |
| 供应商发票 | /api/supplier-invoices/summary | documentStatus | grossAmount（发票金额） |
| 供应商贷/借项 | /api/supplier-credit-debit-notes/summary | status | adjustmentTotal（调整金额） |
| 付款核销 | /api/supplier-payments/summary | status | amount（付款金额） |
| 贷项/借项通知单 | /api/credit-debit-notes/summary | status | adjustmentTotal（调整金额） |
| 收款核销 | /api/receipts/summary | status | amount（收款金额） |
| 记账凭证 | /api/gl/journal-entries/summary | status（String） | — |

## 3. 用例

### MSU-01 基本聚合
- Given 数据库有 N 张采购订单（含软删）
- When GET /api/purchase-orders/summary
- Then 200；`total` = 未删除数；`byStatus` 各状态计数正确；`amount.value` 为 Decimal 字符串（如 `"12345.6700"`），非 number

### MSU-02 空库
- Given 模块无任何记录
- Then 200；`total = 0`；`byStatus = {}`；`amount` 为 undefined（无金额卡）

### MSU-03 权限
- Given 无 `<module>:view` 权限
- Then 403

### MSU-04 金额 0 语义
- Given 全部单据金额为 0（`_sum` 为 null）
- Then `amount` 为 undefined（不渲染 0 金额卡）

### MSU-05 前端联动（页面级）
- Given 采购订单列表页
- When 点击 KPI 卡片「已确认」
- Then 状态筛选下拉同步为 CONFIRMED，列表按 status=CONFIRMED 重新查询；点击「全部」清除状态筛选

## 4. 边界

- 只读聚合，不建平行业务真相；金额 Decimal 字符串返回，禁止 toNumber
- 主数据/系统管理/只读报表页（物料/往来单位/用户/试算平衡等）不在本 Gate 范围
- 失败静默隐藏（summary API 不可用时列表功能不受影响）
