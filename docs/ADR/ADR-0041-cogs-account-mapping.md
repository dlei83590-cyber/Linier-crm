# ADR-0041：多 COGS 科目映射（按物料类型）

- 状态：**Accepted**（CTO 授权解除 D9 成本核算 HOLD 续；2026-08-20）
- 日期：2026-08-20
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：ADR-0040（GL COGS 固定科目）、ADR-0039（出库结转）、ADR-0038（成本层）

---

## 背景

ADR-0040 实现 GL COGS 固定科目（借 6401 / 贷 1403）。库存出库涉及不同物料类型（成品/半成品/原材料/外购件等），贷方库存科目应按物料类型区分（中国市场科目习惯）。

## 决策

1. **贷方科目按 itemType 映射**（getCogsInventoryAccountCode，纯函数可单测）：
   - 成品/半成品 → **1405 库存商品**
   - 原材料/外购件/辅料/消耗品/包装/工装/资产 → **1403 原材料**（保守默认；资产/服务特殊处理后续）
   - 未知类型 → 1403（fail-safe 默认）
2. **借方统一 6401 主营业务成本**（不变）；金额 = outCost（ADR-0039 出库结转）。
3. **接线**：ledger-command COGS 分录前查 Item.itemType → 选贷方科目（同事务；Item 缺失 → 默认 RAW_MATERIAL→1403）。
4. **seed**：新增 1405 库存商品（ASSET, DEBIT）。
5. **边界**：SERVICE（服务）不出库无 COGS；资产出库成本特殊处理（固定资产）后续；借方多 COGS 科目（按业务类型）后续。

## 影响

- seed +1405；ledger-command COGS 贷方按 itemType 映射；零 Migration
- 成品出库 COGS 贷 1405，原材料出库贷 1403——试算/余额按科目准确归集

## 后续（独立 backlog）

- 借方多 COGS 科目（按业务类型：销售成本/生产成本/其他）
- 资产出库成本特殊处理（固定资产入账）
- FIFO / Cost Layer / Landed Cost / 仓库维度成本
