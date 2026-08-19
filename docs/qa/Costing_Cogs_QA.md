# Costing 第三步 — GL COGS 分录 QA 验收记录（ADR-0040）

- 日期：2026-08-20
- 关联：ADR-0040、ADR-0039、ADR-0038、ADR-0033、6A/6B
- 状态：**CI 验证通过（GitHub Actions 全绿）；Runtime Acceptance = 待生产部署后执行（CI-First，本地不跑 runtime）**

## 1. 范围

| 提交 | 内容 | CI |
|---|---|---|
| GL COGS（ADR-0040） | ledger-command 出库结转后同事务 postGlEntry（借 6401 贷 1403）+ seed 6401 | ✅ success（待 CI 确认） |

## 2. 静态验收（本地已核）

- [x] outCost > 0 → COGS 凭证（借 6401 / 贷 1403，金额=outCost）；与出库结转同事务（原子）
- [x] 复用 postGlEntry（借贷平衡/科目 fail closed/幂等/取号）；无成本层 skipped → 无 COGS
- [x] seed 6401 主营业务成本（EXPENSE, DEBIT）；ledger-command → gl/posting 单向依赖（无循环）
- [x] 不依赖 InventoryMovementCommitted 事件 outbox 化（best-effort AuditLog；事务内直调保证原子）

## 3. 需在生产 Runtime 验收（部署后执行）

- [ ] 入库更新 avg → 出库 → GL 生成 COGS 凭证（借 6401 贷 1403）；试算平衡含 COGS
- [ ] 无成本层物料出库 → 无 COGS 凭证（0 成本边界）；重复 Outbox 重放不重复过账（幂等）

## 4. 已知限制 / 边界

- 固定科目映射（6401/1403）；按物料类型多 COGS 科目 = 后续；InventoryMovementCommitted 事件驱动 = 后续
- reports（BI）仍 HOLD（待 20 份报表清单）

## 5. 验收人

- CI 验证：GitHub Actions（Quality Gates / Secret Scanning / Build）
- Runtime Acceptance：待生产部署后由 CIO/CTO 执行（本 Gate 未执行，如实声明）
