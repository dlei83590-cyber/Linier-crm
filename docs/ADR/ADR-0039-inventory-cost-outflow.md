# ADR-0039：成本核算第二步 — 出库结转（cost outflow）

- 状态：**Accepted**（CTO 授权解除 D9 成本核算 HOLD 续；2026-08-20）
- 日期：2026-08-20
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：ADR-0038（成本层移动平均）、6A/6B（InventoryLedgerCommand Core：executeLedgerAtom 为 Movement 落定唯一事实点）

---

## 背景

ADR-0038 已落地入库移动平均。第二步 = **出库结转**：库存 OUT（领用/销售/调拨出库/盘亏/退货冲回）按当前移动平均成本结转，冲减 InventoryCostBalance（totalCost -= qty×avg；onHandQty -= qty）。

## 决策

1. **结转事实点 = InventoryLedgerCommand Core（executeLedgerAtom）**：
   - executeLedgerAtom 是 Movement 落定唯一事实点（6A Consumer 与 6B Transfer/Adjustment/Conversion 共用），在 Movement INSERT + Projection UPSERT **同事务内**追加成本结转（OUT only）——全有或全无，业务语义一致（出库事实落定即结转成本）。
   - **不写 Movement/StockProjection**（成本层独立表 InventoryCostBalance——红线延续）。
2. **结转规则（applyOutboundCost）**：
   - 查 item 级 InventoryCostBalance；无成本层或 avg ≤ 0 → 不结转（首版边界：无成本事实物料按 0 成本出库，声明于 QA）。
   - 结转：`outCost = min(qty × avg, totalCost)`（**不制造负成本**）；`totalCost -= outCost`；`onHandQty -= qty`（成本层镜像；不足时 onHandQty 可归零不取负）。
   - 幂等：InventoryCostSource sourceKey = `COST_OUT:{movementId}` @unique（Movement 五元幂等已保证不重复；DB 兜底）。
3. **GL COGS 分录 → 后续第三步**（本 Gate 不做）：
   - 出库结转与 GL 联动（借 6401 主营业务成本 贷 1403）需要 InventoryMovementCommitted 事件 outbox 化 + domain consumer handler——独立 Gate，避免 ledger-command 耦合 GL。
4. **API/前端**：复用 GET /api/inventory-costs（结转后 totalCost/avg 自动反映）；无新 API。
5. **权限**：无变化（查询仍 inventory-cost:view）。

## 影响

- 零 Migration（复用 InventoryCostBalance/InventoryCostSource）
- ledger-command.ts 增加 applyOutboundCost 调用（OUT only，同事务）；6B 操作（Transfer/Adjustment/Conversion）出库自动结转
- 成本层 onHandQty 与 StockProjection 数量可能因"无成本层物料"不同步（声明边界：成本层仅镜像有成本事实的物料）

## 后续（独立 backlog）

- GL COGS 分录（Movement 事件 outbox 化 + consumer）
- FIFO / Cost Layer / Landed Cost / 仓库维度成本
- 成本差异分析 / 期末成本重估
