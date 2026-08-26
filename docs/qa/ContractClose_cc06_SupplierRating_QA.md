# Contract Close cc-06 — 客户等级→供应商评级匹配 QA（Production Smoke）

- 日期：2026-08-25
- 模块：customer-supplier-rating-rule + sales-order.supplier-recommendations + business-partner customerLevel + 系统设置表格页
- 验证事实源：GitHub CI（Quality Gates/Build/Secret Scanning）+ 生产 Runtime Smoke（人工）
- 红线：不硬编码商业逻辑（映射只在 CustomerSupplierRatingRule）；无 AI 评分/权重算法/Matching Engine；复用 CustomerLevel / CustomerCreditRating 枚举，不造平行事实

## 预置

1. 生产/沙箱 DB 应用 Migration 0055（ALTER BusinessPartner ADD customerLevel + CREATE CustomerSupplierRatingRule）。
2. 至少 2 个供应商 BusinessPartner（type=SUPPLIER/BOTH），通过 供应商详情 → 信用（/api/suppliers/:id/credit）维护 PartnerCredit.rating（如 甲=AA、乙=B、丙不设评级）。
3. 至少 2 个客户 BusinessPartner（type=CUSTOMER/BOTH），通过 往来单位编辑维护 customerLevel（如 客户A=VIP）。
4. 商品 Item 与 SupplierItem 关系（订单行商品 → SupplierItem.supplierId），部分标记 isPreferred=true。

## Production Smoke Checklist

- [ ] step 1 系统设置：打开 /settings/supplier-rating-rules（SUPER_ADMIN），新建规则：客户等级=VIP → 最低供应商评级=A，启用。
- [ ] step 2 客户档案：编辑客户A（type=CUSTOMER），类型下出现「客户等级」，选 VIP 并保存成功；详情回显。
- [ ] step 3 创建销售订单（Quotation convert 或既有订单）：订单客户 = 客户A（VIP）。
- [ ] step 4 订单详情页 → 推荐供应商（Q 线）：页面展示依据文案（含「客户等级」「要求供应商评级 ≥ A」「优选供应商优先」）；列表只出现满足规则供应商（甲 AA / 乙 B；丙无评级不出现）；优选供应商排前；评级列展示 canonical rating（AA/B）。
- [ ] step 5 无规则默认：删除/停用 VIP 规则 → 刷新订单详情 → 展示全部匹配供应商（含丙），basis 文案说明「未配置评级规则（展示全部）」。
- [ ] step 6 权限：以 MEMBER/无 customer-supplier-rating-rule 角色访问规则页 → 403 / 页面被 PermissionGuard 拦截；规则 create/edit/delete 仅 SUPER_ADMIN/ADMIN。
- [ ] step 7 人工选择仍可用：用户可忽略推荐列表，按既有流程选择其它供应商（推荐仅为信息性投影）。

## 单测覆盖（GitHub CI unit tests）

- 规则 CRUD：创建 201 / 同等级 409 / 非法枚举 400 / 列表分页 / isActive 过滤 / PATCH CAS 200/409 / 软删除。
- 推荐投影：规则命中过滤（≥门槛，无评级不满足）/ 门槛 AAA 空 rows / 无规则默认展示全部 / 客户未设等级展示全部且不查规则 / 优选优先排序 / 无 SupplierItem rows=[] / 404 / 403。
- 前端：销售订单详情页 basis 文案展示 + 仅列出满足规则供应商（page.test.tsx）。

## Known Limitations

- 推荐为只读投影：不自动替客户选择供应商，不改变订单创建/供应商选择流程（人工可覆盖，符合契约）。
- 供应商评级门槛依赖 PartnerCredit.rating 已维护；未维护评级的供应商在规则命中时被过滤（需在系统设置或供应商信用页补充评级）。
- 本页无独立菜单入口（REGISTRY DELTA REQUIRED：菜单由 CC-10 Registry SSOT 统一维护）。
- 规则为全局单一映射（客户等级→最低评级），不支持按物料/区域细分（最小范围，非 Generic Rule Engine）。
