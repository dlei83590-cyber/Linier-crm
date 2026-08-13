# Report Catalog — 分析与报表信息架构

> Frontend Productization Reset · F2-0 IA v2 配套文档（docs-only）
>
> 原则（CTO 22:30 指令）："分析与报表"现在**只做信息架构，不实现指标**。
> 当前可访问资料不足以证明原始 20 份报表的全部指标定义，**禁止凭经验猜报表**。
> 等完整 20 份源报表可核验后，再做正式 **Report Mapping Gate**。

## UI 分类（先锁，不增删）

| 分类 | 说明 | 状态 |
|---|---|---|
| 经营分析 | 公司级经营总览（收入/毛利/应收等） | Catalog only |
| CRM / 项目 | 客户、机会、项目过程分析 | Catalog only |
| 销售分析 | Quotation / Sales Order / Delivery / Invoice / AR | Catalog only |
| 采购分析 | PR / PO / Receipt / GRIR 相关 | Catalog only |
| 库存分析 | 库存余额、周转、盘点差异 | Catalog only |
| 财务分析 | AP / GL / 资金（依赖 5C-2 / GL 开放） | Catalog only |

## 每份报表必须完成的字段（未来逐份核验）

| 字段 | 说明 |
|---|---|
| 原报表 | 源报表名称/编号（来自原始 20 份清单） |
| 使用部门 | 该报表的实际使用方 |
| 指标 | 精确指标定义（公式、口径），禁止猜测 |
| 过滤维度 | 时间、组织、业务维度等过滤条件 |
| 权威事实源 | 数据来自哪个 FINAL contract / Read API |
| Query Contract | 对应后端查询契约（endpoint / 参数 / 返回结构） |

## 当前 HOLD 面

- 未定义指标的报表：**禁止实现**
- 新库存 Read API（Stock Projection / Inventory Ledger 等）：**HOLD**（F2-7，必须等独立 Backend Read Model Gate）
- 前端不得 SUM InventoryMovement / 拼多个 Operations API / 自行推算 onHand
- 5C-2 / GL / Costing / Reservation：**HOLD**

## 下一步

1. 收集/核验完整 20 份源报表清单与指标定义
2. 逐份完成上表字段 → 形成 Report Mapping
3. CTO 签 **Report Mapping Gate** 后，才进入报表实现（F2-Reports）
