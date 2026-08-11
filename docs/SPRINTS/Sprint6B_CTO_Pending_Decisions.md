# Sprint 6B：CTO Pending Decisions（库存作业待拍板决策清单）

- 版本：v0.2（**CTO 6B Design Review #7975 拍板结果——P1-P12 全部 Final**；Re-review 通过前 Schema / Migration / API 继续 HOLD）
- 日期：2026-08-11
- 维护者：CIO（JINZA）提案 ｜ 审核：CTO
- 关联：Sprint6B_Inventory_Operations_Architecture_Process_Gate.md / ADR-0026（Approved with Changes）/ Sprint6B_Inventory_Operations_Field_Matrix.md / ADR-0025（6A Implemented）/ EVENTS.md（v1.26）

> **Gate 铁律（CTO #7895/#7975）**：6B 是库存作业领域——最容易污染 6A SSOT 的四种场景（Transfer 双边原子性、Count-Adjustment 事实边界、Conversion 守恒、绕过 Ledger Command 直写）。**Schema / Migration / API 继续 HOLD**——CTO 6B Gate Re-review 通过后才放行。**P1-P12 已全部 Final（CTO #7975 拍板）**。

---

## P1：Transfer 是同步双边 Ledger Command 还是 Outbox 驱动 —— ✅ Final（CTO #7975）

**Transfer 同步双边 Ledger Command**：Transfer 业务事实 + SOURCE_OUT + DESTINATION_IN **同一事务**提交；**不走 Outbox atom 消费**。调拨单 EXECUTED 成功 = 库存账双边已落定（无运输窗口）；直接复用 6A 维度锁/禁负库存/幂等逻辑。6A 现有 IN/OUT（入库/退货）维持 Outbox 不动。

## P2：Transfer 是否需要独立 Transfer Order / Transfer Document —— ✅ Final（CTO #7975）

**独立 Transfer Document**（TransferHeader + TransferLine + 状态机 DRAFT → SUBMITTED → APPROVED → EXECUTED / CANCELLED，创建即取号 TRF）；EXECUTED 才触发双边 Movement。**审批走既有 Workflow Policy**：跨仓默认需审批，同仓是否免审由策略配置，**不硬编码**。

## P3：跨仓与同仓库位移动是否统一模型 —— ✅ Final（CTO #7975）

**统一模型**：同一 Transfer Document + 同一组 Movement 结构（SOURCE_OUT + DESTINATION_IN，warehouseId 可同可异）；transferType 区分跨仓/同仓。**同一五维不能自调拨**（源=目标维度 → 拒绝）。

## P4：Transfer 是否允许负库存 —— ✅ Final（CTO #7975）

**不允许负库存，无紧急负库存豁免**：SOURCE_OUT 在五维锁内检查 `onHandQty >= qty`，不足稳定拒绝（409），与 6A P6 Final 一致。Transfer 不制造负库存例外。

## P5：Transfer serial/batch 精确继承规则 —— ✅ Final（CTO #7975）

**serial 精确继承**：每 serial 一对 Movement（SOURCE_OUT serialNo 取 X + DESTINATION_IN serialNo 取 X，quantity=1，五元 movementAtomKey 取 serialNo），不重生成。
**batch 精确继承**：SOURCE_OUT batchNo 取 B → DESTINATION_IN batchNo 取 B；**首版不拆批、不换批**。

## P6：Count snapshot/freeze 策略 —— ✅ Final（CTO #7975，含 Blocking ①/② 修正）

**动态盘点 + per-line atomic snapshot**（不冻结维度）：
- 每一盘点行实际录入 `countedQty` 时，**同一事务**读取该五维 `StockProjection` → 保存 `bookQtyAtCount` / `countedAt` / `ledgerWatermark`
- `varianceQty = countedQty - bookQtyAtCount`
- **不使用动态补偿公式**（旧 `netVariance = variance + 盘点期间 IN - OUT` 会把正常业务 Movement 重复算进差异——snapshot 为 100、期间 +10、实盘 112 → 真实差异 +2，旧公式却得 +22；已删除）
- **watermark 仅审计**：`movementNo` 只是可读业务编号，**不作为并发时序/提交顺序主键**；不参与 variance 算法；未来严格 replay 需单独设计 **monotonic ledgerSeq**，不复用 MV 编号

## P7：Count variance 的审批阈值 —— ✅ Final（CTO #7975）

**差异审批支持策略配置，System Default = 0 自动阈值**：即**所有非零 variance 首版默认需审批**；后续配置可放宽（如按百分比/绝对值设自动入账阈值）。不默认全自动。

## P8：Adjustment 权限与 reason code —— ✅ Final（CTO #7975）

**受限权限 + reasonCode 字典**：
- 新受限权限 `inventory-adjustment:apply`（仅 SUPER_ADMIN/ADMIN，对齐 6A `inventory-ledger:consume` 的 SYSTEM_PERMISSIONS 模式）
- reasonCode：**系统保留码（COUNT_VARIANCE / DAMAGE / LOSS / GIFT / SYSTEM_CORRECTION / MANUAL）+ 可扩展字典**——不要把所有原因永久写死 enum

## P9：Adjustment 是否允许直接人工创建 —— ✅ Final（CTO #7975）

**允许 Manual Adjustment，但实行 maker-checker**：
- **创建人与批准/Apply 人不得相同**
- 高权限（`inventory-adjustment:apply`）+ 强审计（全部留 audit trail）
- 不允许普通角色直接改库存；serial-managed 人工调整仍逐 serial 原子化

## P10：Conversion 多输入/多输出模型 —— ✅ Final（CTO #7975，含 Blocking ③ 修正）

**6B Conversion 收窄为同 item 的 Repack / UOM Conversion**：
- **同一 itemId** 内包装/单位转换（如 1 box → 10 pcs）
- **多物料 N×M Transformation（多原料→多产出 / 装配 / 拆解 / 工艺转换）HOLD 到未来 Manufacturing / Transformation Gate**——防止 6B 一脚进入 MRP/BOM
- 6B 只支持单输入单输出（CONSUME + PRODUCE 各一条，同一 movementGroupId）

## P11：Conversion UOM 与数量守恒口径 —— ✅ Final（CTO #7975）

**明确 Inventory Base UOM**：
- Movement/Projection 数量**以 canonical inventory UOM 计账**；业务 UOM 与换算率仅作为 snapshot（单据显式声明，不隐式查表）
- 守恒：换算到 base UOM 后 `ΣCONSUME 数量` 与 `ΣPRODUCE 数量` 相等
- **禁止把不同物料/不同量纲硬算成 Σ 相等**（KG 与 PC 没有通用 base 可直接相等——那已是 BOM/Assembly 语义，不进 6B）

## P12：Operations 是否全部复用现有 Outbox/Consumer，还是同步 Ledger Command 与异步 Consumer 分层 —— ✅ Final（CTO #7975）

**分层**：
- **Transfer / Adjustment / Repack Conversion → 同步共享 Ledger Command**（同事务落 Movement，复用 6A 维度锁/禁负/幂等核心逻辑，不经过 Outbox）
- **Count → 业务事实落库**（差异经 Adjustment Command 同步处理，不直接写 Ledger）
- **6A 现有 IN/OUT（入库/退货）维持 Transactional Outbox + Consumer 不动**（6A FINAL APPROVED 零改造）

> **实现要求（CTO #7975 锁死）**：**6B 必须抽取共享 `InventoryLedgerCommand` core**——不能让 6A Consumer 保留一套 Movement/Projection/锁逻辑、6B Transfer 再复制一套；同步 Command 与 Outbox Consumer 共用同一底层（原子落 Movement + 投影 + 禁负库存 + 幂等），否则半年后一定分叉。

---

## 汇总表（CTO 6B Design Review #7975 拍板结果）

| # | Pending | CTO Final 决策 | 结论 |
| --- | --- | --- | --- |
| P1 | Transfer 落账方式 | **同步双边 Ledger Command**（SOURCE_OUT + DESTINATION_IN 同一事务，不走 Outbox atom 消费） | ✅ Final |
| P2 | Transfer 是否独立单据 | **独立 Transfer Document**（DRAFT→SUBMITTED→APPROVED→EXECUTED/CANCELLED）；审批走既有 Workflow Policy（跨仓默认需审、同仓策略配置） | ✅ Final |
| P3 | 跨仓/同仓统一模型 | **统一模型**；同一五维不能自调拨 | ✅ Final |
| P4 | Transfer 负库存 | **不允许，无紧急豁免**（6A 一致） | ✅ Final |
| P5 | serial/batch 继承 | **serial 精确继承不重生成；batch 精确继承，首版不拆批不换批** | ✅ Final |
| P6 | Count snapshot/freeze | **动态盘点 + per-line atomic snapshot**；variance 取 countedQty 减 bookQtyAtCount；**watermark 仅审计**（movementNo 不作并发时序主键） | ✅ Final |
| P7 | Count variance 审批阈值 | **策略配置，System Default = 0**：所有非零 variance 首版默认需审批 | ✅ Final |
| P8 | Adjustment 权限/reason code | **受限权限 `inventory-adjustment:apply` + 系统保留码 + 可扩展字典** | ✅ Final |
| P9 | Adjustment 人工创建 | **允许 Manual，maker-checker**（创建人与批准/Apply 人不得相同）+ 高权限 + 强审计 | ✅ Final |
| P10 | Conversion 模型 | **收窄为同 item Repack / UOM Conversion**；多物料 N×M Transformation HOLD 到制造阶段 | ✅ Final |
| P11 | Conversion UOM 守恒 | **Inventory Base UOM canonical 计账 + 显式换算率 snapshot**；禁不同物料/量纲硬算 Σ 相等 | ✅ Final |
| P12 | Outbox vs 同步分层 | **分层：Transfer/Adjustment/Repack 同步共享 Ledger Command；Count 事实落库后调 Adjustment；6A IN/OUT 维持 Outbox 不动**；**抽取共享 InventoryLedgerCommand core 为 6B 实现前置** | ✅ Final |

> **四条库存账红线对应**：P1/P3/P4/P5（Transfer 双边原子性 + 禁负 + 继承）、P6/P7（Count-Adjustment 事实边界 + per-line snapshot + 阈值）、P10/P11（Conversion 收窄 + base UOM 守恒）、P8/P9/P12（严格经共享 Ledger Command，不绕过 SSOT）。**Reservation / Costing 全程不进入 6B Gate。**
