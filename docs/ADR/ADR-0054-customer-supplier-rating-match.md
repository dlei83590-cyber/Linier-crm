# ADR-0054：客户等级 → 供应商评级匹配（订单推荐供应商评级门槛）

- 状态：**Accepted（Contract Close cc-06 supplier-rating，2026-08-25）**
- 日期：2026-08-25
- 维护者：AI Agent（Contract Close 线）｜审核：CTO
- 关联：Contract Close（合同功能最终收口 → 全链生产测试）；Migration 0055；ROADMAP 变更记录

---

## 决策

**结论：BusinessPartner 增加最小字段 `customerLevel`（复用 CustomerLevel 枚举），新增专用极小配置模型 `CustomerSupplierRatingRule`（customerLevel → minimumSupplierRating），订单推荐供应商投影按门槛过滤 + 优选优先排序 + 页面展示推荐依据文案。**

| 对象 | 决策 | 说明 |
|---|---|---|
| BusinessPartner.customerLevel（CustomerLevel?，可空） | 新增 | 客户等级 SSOT 落在统一往来单位 BusinessPartner（SalesOrder.customerId 方向）；复用 CustomerLevel 枚举（VIP/KEY/REGULAR/PROSPECT），**不新建 A/B/C 平行枚举**（任务指示的 A/B/C 为示意，仓库 canonical 枚举即 CustomerLevel） |
| CustomerSupplierRatingRule（customerLevel @unique / minimumSupplierRating / isActive） | 新增 | 专用极小配置模型（**非 Generic Rule Engine**）；系统设置简单表格维护；无规则 = 不设门槛（默认展示全部） |
| 供应商评级 SSOT | 复用 PartnerCredit.rating（CustomerCreditRating 枚举） | 供应商评级唯一权威 = PartnerCredit（AR/AP 共享信用，已由 /api/suppliers/:id/credit 维护）；不新增 SupplierRating2 |
| 推荐投影 | 改造 GET /api/sales-orders/:id/supplier-recommendations | SalesOrder.customerId → customerLevel → active rule → 过滤 PartnerCredit.rating ≥ minimumSupplierRating → 排序：优选（SupplierItem.isPreferred 计数）→ 评级降序 → 覆盖商品数；返回 basis 文案（页面必须展示）；用户仍可人工选择 |
| 评级有序语义 | RATING_RANK（AAA=7…C=1） | 单一实现，规则门槛过滤与推荐排序共用；无评级 = 0（视为不满足门槛） |
| 权限 | 新增模块 `customer-supplier-rating-rule`（view/create/edit/delete） | 与 PERMISSION_MODULES + seed 同步注册（ADR-0028）；仅 SUPER_ADMIN/ADMIN 静态授权（系统配置）；MANAGER 不放开 |

## 背景

- 合同：订单根据客户级别自动关联对应评级供应商。现有能力：SalesOrder.customerId → BusinessPartner；SupplierItem（isPreferred 优选）；PartnerCredit.rating（canonical 供应商评级）；推荐投影已存在（Q 线只读，`GET /api/sales-orders/:id/supplier-recommendations`，原本仅按 BusinessPartner.creditRating 自由文本排序）。
- 审计结论：BusinessPartner 无客户等级字段；Customer 模型虽有 level（CustomerLevel 枚举）但 Customer 属遗留子模型（ADR-0051 DEPRECATE），业务单据全指向 BusinessPartner——客户等级必须落在 BusinessPartner。
- 禁止项：AI Supplier Scoring / 复杂权重算法 / Matching Engine；不硬编码隐含商业逻辑（映射由系统设置配置，而非代码常量）。

## 设计要点

1. **零硬编码商业逻辑**：映射关系只存在于 `CustomerSupplierRatingRule` 表（系统设置简单表格维护）；无规则默认展示全部（不回退到隐藏商业规则）。
2. **不造平行事实**：客户等级复用 CustomerLevel 枚举；供应商评级复用 CustomerCreditRating 枚举（PartnerCredit.rating）。
3. **推荐仍是只读投影 + 人工可覆盖**：不改变订单创建/供应商选择流程；推荐列表仅信息性。
4. **迁移 0055**：仅 ALTER TABLE BusinessPartner ADD customerLevel（可空，存量不迁移）+ CREATE TABLE CustomerSupplierRatingRule（手写迁移，无新枚举类型）。

## 边界

- 不实现自动替客户选择供应商（推荐仅排序/过滤展示）。
- 不做 AI 评分 / 权重算法 / Matching Engine。
- 不在 Customer 遗留模型上新增字段（DEPRECATE 状态，ADR-0051）。
- 前端只做本线必要接线：客户档案新建/编辑维护 customerLevel + 订单详情页展示推荐依据 + 系统设置简单表格页（REGISTRY DELTA REQUIRED：菜单入口由 CC-10 Registry SSOT 统一维护）。
