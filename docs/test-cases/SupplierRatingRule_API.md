# SupplierRatingRule_API.md — 客户等级→供应商评级匹配 API 测试用例

- 日期：2026-08-25
- 模块：customer-supplier-rating-rule + sales-order.supplier-recommendations（Contract Close cc-06，ADR-0054）
- 验证事实源 = GitHub CI + 生产 Runtime smoke（CI-First）
- 红线：不硬编码商业逻辑（映射只在 CustomerSupplierRatingRule 表）；禁止 AI 评分/权重算法/Matching Engine；客户等级/供应商评级均复用既有枚举（CustomerLevel / CustomerCreditRating），不造平行事实

## 1. 认证与权限

| # | 用例 | 输入 | 期望 |
| --- | --- | --- | --- |
| A1 | 无权限 | MEMBER 调规则 create/edit/delete | 403 FORBIDDEN（customer-supplier-rating-rule 仅 SUPER_ADMIN/ADMIN 静态授权，MANAGER/MEMBER 无） |
| A2 | SUPER_ADMIN/ADMIN | 全部端点 | 200/201 |
| A3 | 推荐投影 | 无 sales-order:view | 403（requirePermission） |

## 2. /api/customer-supplier-rating-rules

| # | 用例 | 输入 | 期望 |
| --- | --- | --- | --- |
| C1 | POST 创建规则 | { customerLevel: "KEY", minimumSupplierRating: "AA" } | 201；approvalStatus=APPROVED（配置即生效） |
| C2 | POST 同等级重复 | customerLevel=KEY 已有规则 | 409 CONFLICT「已配置评级规则」（不覆盖） |
| C3 | POST 非法枚举 | customerLevel: "SILVER" | 400 VALIDATION_ERROR |
| C4 | GET 列表 | ?page=1&pageSize=20 | 200 分页；soft-deleted 已过滤 |
| C5 | GET isActive 过滤 | ?isActive=false | 200 仅停用 |

## 3. /api/customer-supplier-rating-rules/:id

| # | 用例 | 输入 | 期望 |
| --- | --- | --- | --- |
| G1 | GET 详情 | id | 200 |
| P1 | PATCH 正确 version | { version, minimumSupplierRating: "A", isActive } | 200 version+1 |
| P2 | PATCH 过期 version | 旧 version | 409 VERSION_CONFLICT |
| P3 | PATCH 空更新 | 仅 version | 400 VALIDATION_ERROR |
| D1 | DELETE | id | 200 软删（deletedAt + isActive=false）；再 GET → 404 |
| D2 | DELETE 后规则不生效 | 删除后查推荐 | ruleApplied=false（无规则默认展示全部） |

## 4. GET /api/sales-orders/:id/supplier-recommendations（cc-06 匹配）

| # | 用例 | 输入 | 期望 |
| --- | --- | --- | --- |
| R1 | 规则命中 | 客户 VIP + 规则 VIP→A；供应商：甲 AA（优选）/乙 B/丙无评级 | rows 仅 甲+乙（丙无 PartnerCredit 评级不满足门槛）；甲优先（优选）；supplierRating=AA；ruleApplied=true；minimumSupplierRating=A；basis 含「客户等级」「≥ A」 |
| R2 | 门槛 AAA | 规则 VIP→AAA，供应商最高 AA | rows 空；ruleApplied=true；basis 仍返回 |
| R3 | 无规则默认 | 客户等级未配置规则 | rows 展示全部匹配供应商（不过滤）；ruleApplied=false；minimumSupplierRating=null；basis 含「未配置评级规则」 |
| R4 | 客户未设等级 | customerLevel=null | rows 展示全部；ruleApplied=false；basis 含「客户未设置等级」；不查询规则表 |
| R5 | 优选排序 | 乙优选（preferredCount=1）但评级 AA；甲非优选评级 AAA | 乙排前（优选优先）再评级降序 |
| R6 | 无 SupplierItem | 订单行无 item / 无关系 | rows=[]；响应结构完整（basis 等） |
| R7 | 订单不存在 | id 随机 | 404 SALES_ORDER_NOT_FOUND |
| R8 | 页面展示 | 订单详情页 | 展示 basis 文案 + 供应商评级列 + 优选徽标；用户仍可人工选择 |
