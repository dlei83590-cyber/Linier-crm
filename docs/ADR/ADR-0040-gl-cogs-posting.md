# ADR-0040：GL COGS 分录（出库结转过账）

- 状态：**Accepted**（CTO 授权解除 D9 成本核算 HOLD 续；2026-08-20）
- 日期：2026-08-20
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：ADR-0039（出库结转）、ADR-0038（成本层移动平均）、ADR-0033（GL 过账服务）、6A/6B（InventoryLedgerCommand Core）

---

## 背景

ADR-0039 已实现出库结转（applyOutboundCost 在 executeLedgerAtom OUT 落定同事务，outCost 写入 InventoryCostSource）。第三步 = **GL COGS 分录**：出库结转金额过账为 借 6401 主营业务成本 / 贷 1403 原材料。

## 决策

1. **过账点 = executeLedgerAtom 同事务（出库结转后直接 postGlEntry）**：
   - applyOutboundCost 已算出 outCost（非 skipped 且 > 0）→ 同一事务内调用 `postGlEntry(tx, { sourceType:'InventoryMovementCommitted', sourceId: movementId, lines:[借 6401 outCost / 贷 1403 outCost] })`——**COGS 与出库结转原子**（出库成功 ⇒ COGS 必过账；失败整体回滚）。
   - 复用 postGlEntry（借贷平衡/科目 fail closed/幂等 @@unique(sourceType,sourceId)/JRN 取号）——不新造过账逻辑。
   - **不依赖 InventoryMovementCommitted 事件 outbox 化**（当前 best-effort AuditLog，非原子；事件通道改造风险大且非必要——COGS 事实在出库事务内已确定）。后续若需事件驱动 GL，可再 outbox 化（独立 backlog）。
2. **科目映射（首版）**：借 `6401 主营业务成本`（EXPENSE, DEBIT）/ 贷 `1403 原材料`（库存出库统一走原材料科目）；**按物料类型/费用类别科目映射 = 后续 backlog**（首版固定映射，声明边界）。
3. **范围**：仅 OUT 且 outCost > 0（无成本层物料 skipped → 无 COGS 分录，0 成本出库）；IN 不产生 COGS。
4. **耦合说明**：ledger-command（共享 Core）→ gl/posting 单向依赖（GL 不依赖 ledger，无循环）；出库结转/COGS 与 Movement 落定的原子性要求如此，属领域事实联动（非绕过 Core——postGlEntry 是 GL 领域服务，非 Ledger mutation）。
5. **API/前端**：复用 GL 凭证查询（/api/gl/journal-entries 过滤 sourceType=InventoryMovementCommitted）与库存成本查询；无新 API。

## 影响

- seed：新增 6401 主营业务成本科目
- ledger-command.ts：applyOutboundCost 后调用 postGlEntry（OUT 且 outCost>0）
- 出库即产生 COGS 凭证（JRN 取号）；试算平衡/利润表自动包含（REVENUE/EXPENSE 聚合）

## 后续（独立 backlog）

- 按物料类型/费用类别科目映射（多 COGS 科目）
- InventoryMovementCommitted 事件 outbox 化 + 事件驱动 GL（替代事务内直调）
- FIFO / Cost Layer / Landed Cost / 仓库维度成本
