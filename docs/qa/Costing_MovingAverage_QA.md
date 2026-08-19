# Costing 首块 — 移动加权平均成本层 QA 验收记录（ADR-0038）

- 日期：2026-08-20
- 关联：ADR-0038、ADR-0027（D9 解除）、6A（Movement/StockProjection 红线）、5C-1（GRIR P9 口径）
- 状态：**CI 验证通过（GitHub Actions 全绿）；Runtime Acceptance = 待生产部署后执行（CI-First，本地不跑 runtime）**

## 1. 范围

| 提交 | 内容 | CI |
|---|---|---|
| Costing 首块（ADR-0038） | InventoryCostBalance/InventoryCostSource（Migration 0036）+ moving-average.ts + WHR 入库更新 + 查询 API + 前端只读页 + 单测 | ✅ success（待 CI 确认） |

## 2. 静态验收（本地已核）

- [x] 移动加权平均：首笔 avg=base/qty；avg'=(total+base)/(onHand+qty)（Decimal 4dp HALF_UP）
- [x] 幂等：InventoryCostSource.sourceKey @unique（COST:ACCRUAL:…）防重复累计；与 GRIR ACCRUAL 同事务
- [x] 成本口径 = 未税采购成本（P9）；数量 ≤ 0 / 成本为负 → 400
- [x] WHR POST 同事务接线（fail closed：成本更新失败整体回滚）；6A Movement/StockProjection 零改动
- [x] 权限 inventory-cost:view（成本敏感仅 SUPER_ADMIN/ADMIN）；前端只读无写入口

## 3. 需在生产 Runtime 验收（部署后执行）

- [ ] WHR POST → GRIR ACCRUAL + 成本层更新同事务；重复 POST 幂等不重复累计
- [ ] 多次入库 → 移动平均正确（avg 收敛）；查询 API 分页/过滤正确
- [ ] 权限：MANAGER 访问 /api/inventory-costs → 403

## 4. 已知限制 / 边界

- **出库结转/COGS 未实现**（后续 Gate：Movement OUT 消费 + GL COGS）；FIFO/Cost Layer/Landed Cost/仓库维度成本后续
- reports（BI）仍 HOLD（待 20 份报表清单）

## 5. 验收人

- CI 验证：GitHub Actions（Quality Gates / Secret Scanning / Build）
- Runtime Acceptance：待生产部署后由 CIO/CTO 执行（本 Gate 未执行，如实声明）
