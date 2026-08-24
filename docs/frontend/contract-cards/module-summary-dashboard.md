# Module Summary Dashboard（模块页仪表盘）契约卡

> 状态：FINAL（2026-08-24 用户指令）｜ 前置：各模块列表页 + 列表 API FINAL

## 目标

每个业务单据模块列表页顶部展示「该页面的仪表盘」——KPI 数字卡片条：
**全部 + 按状态计数（点击联动列表状态筛选）+ 头级金额汇总（展示）**。

## 契约

- 数据源：`GET /api/<module>/summary`（只读聚合；同一 Prisma 模型 + 同一状态枚举，不建立平行业务真相）
- 响应：`{ total, byStatus: { <状态枚举>: count }, amount?: { label, value } }`；金额 Decimal 字符串
- 权限：`<module>:view`（与列表 API 一致）
- 前端：`<ModuleKpiStrip statuses data activeStatus onSelectStatus />`（workspace primitive，页面拉数据）

## 状态字段特例

- 质检记录：按 `result`（PENDING/QUALIFIED/PARTIAL/REJECTED）
- 供应商发票：按 `documentStatus`（DRAFT/SUBMITTED/MATCHED/APPROVED/POSTED/CANCELLED）
- 记账凭证：按 `status`（String；DRAFT/SUBMITTED/APPROVED/POSTED/REJECTED）——列表 API 已新增可选 `status` 过滤

## 覆盖（20 模块）

报价单/销售订单/送货单/销售发票/采购申请/采购订单/到货收货/质检记录/仓库收货/采购退货/
库存调拨/库存盘点/库存调整/库存转换/供应商发票/供应商贷借项/付款核销/贷借项通知单/收款核销/记账凭证

## 边界

- 主数据/系统管理/只读报表页不加（无状态业务语义）
- AR/AP 只读投影（应收账款/应付未结项）后续可复用本模式（账龄/未结金额类 KPI）
- 失败静默隐藏；不做实时轮询（MVP）
