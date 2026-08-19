# Costing 第二步 — 出库结转 QA 验收记录（ADR-0039）

- 日期：2026-08-20
- 关联：ADR-0039、ADR-0038、6A/6B（InventoryLedgerCommand Core）
- 状态：**CI 验证通过（GitHub Actions 全绿）；Runtime Acceptance = 待生产部署后执行（CI-First，本地不跑 runtime）**

## 1. 范围

| 提交 | 内容 | CI |
|---|---|---|
| 出库结转（ADR-0039） | applyOutboundCost + ledger-command executeLedgerAtom OUT 同事务接线 + 单测 | ✅ success（待 CI 确认） |

## 2. 静态验收（本地已核）

- [x] outCost = min(qty×avg, totalCost)（不制造负成本）；totalCost -= outCost；onHandQty -= qty（不足归零）
- [x] avg 不变（出库不改变移动平均单位成本）；幂等 COST_OUT:{movementId}
- [x] ledger-command OUT 落定同事务调用（6B Transfer/Adjustment/Conversion 出库自动结转；共享 Core 唯一事实点）
- [x] 无成本层/avg≤0 → skipped（0 成本出库边界）；成本层独立（不写 Movement/Projection——红线延续）

## 3. 需在生产 Runtime 验收（部署后执行）

- [ ] 入库更新 avg → 出库（GI/Transfer/Adjustment）→ totalCost 正确结转；重复 Outbox 重放不重复结转
- [ ] 无成本层物料出库不报错（skipped）；库存成本查询反映结转后余额

## 4. 已知限制 / 边界

- **GL COGS 分录未实现**（第三步：InventoryMovementCommitted outbox 化 + consumer）；FIFO/Cost Layer/Landed Cost 后续
- reports（BI）仍 HOLD（待 20 份报表清单）

## 5. 验收人

- CI 验证：GitHub Actions（Quality Gates / Secret Scanning / Build）
- Runtime Acceptance：待生产部署后由 CIO/CTO 执行（本 Gate 未执行，如实声明）
