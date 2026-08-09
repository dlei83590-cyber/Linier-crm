# Sprint 5B：CTO Pending Decisions（待拍板决策清单）

- 版本：v0.1（草案，待 CTO Design Review 拍板）
- 日期：2026-08-09
- 状态：**设计先行——禁止 Schema / Migration 0023 / API**
- 关联：Sprint5B_China_ERP_Process_Field_Gate.md / ADR-0024（草案）/ Sprint5B_Field_Matrix.md

> 说明：以下 Pending 全部需要 CTO Design Review 拍板后才能进入 Schema/Migration 0023。已标注 CTO #6680 的倾向（如有）。

---

## P1：GoodsReceipt 模型定位（CTO #6680 核心决策点）

**问题**：GoodsReceipt 到底代表"供应商到货/收货事实"，还是"采购入库事实"？

**CTO 倾向**：把两者拆开，避免直送、质检待入库、部分收货、退货把一个单据模型压垮。

**选项**：
- A. 单一 GoodsReceipt（状态机区分 RECEIVED → QUALIFIED → STOCKED）——不推荐，状态矩阵爆炸
- B. 拆两层：`PurchaseReceipt`（到货/收货事实）+ `WarehouseReceipt`（采购入库事实）——**推荐**

**子问题 P1b**：收货单/退货单是否走审批？还是直接录入生效（走 Audit 留痕即可）？建议：5B 第一版直接录入生效（收货是事实记录不是决策），审批留给超收/退货特殊场景。

---

## P2：超收容差与审批

**问题**：是否允许超收？容差多少？超容差谁审批？

**CTO 倾向**：允许小容差（建议 5%）内超收；超容差需审批。

**子问题**：
- P2a：容差默认值（建议 5%，按 Item/Supplier 可配？）
- P2b：超容差审批走 Workflow（module=PURCHASE_RECEIPT？）还是线下？
- P2c：超收部分的成本/金额口径（5C 供应商发票/AP 时处理？）

---

## P3：质检模式

**问题**：质检如何做？免检/抽检/全检？

**子问题**：
- P3a：检验模式按什么配置（Item 品类 / Supplier 等级 / 金额阈值）？
- P3b：**待检库存**是否在 6A 表达（待检状态 vs 直接不可用）？还是 5B 只做"未入库"（待检 = 未创建 WarehouseReceipt）？
- P3c：质检结论谁录入（QC 角色单独权限？）？

---

## P4：直送（Direct Delivery / Direct-to-Project）

**问题**：直送如何判定与标记？

**子问题**：
- P4a：直送标记在 PurchaseReceipt Header 还是 Line？（建议 Line 级——一个收货单可部分直送部分入库）
- P4b：直送需要哪些字段（projectId / 使用地点 / 收货人）？
- P4c：直送的收货确认流程（现场签收？）——5B 是否需要现场签收动作，还是收货即确认？
- P4d：直送是否允许发生在 PO 创建时就声明（PO Line 预留 directDelivery 标记）？还是收货时才决定？

---

## P5：采购退货（Purchase Return）

**问题**：退货是独立 PurchaseReturn 还是负数 GR？

**CTO 倾向**：优先独立 `PurchaseReturn` 业务事实，不做简单负数 GR。

**子问题**：
- P5a：是否允许技术层用"负 movement"表达退货 → **留到 Inventory Ledger（6A）设计时决定**（CTO #6680 明确，5B 不拍）
- P5b：退货可引用的来源（收货行 / 入库行 / 均无——手工指定 item+数量）？
- P5c：退货是否需要审批？
- P5d：退货后 PO 收货投影如何处理（receivedQty 是否回退？建议：`receivedQty` 保持到货口径不后退，另计 `returnedQty`——待拍板）
- P5e：供应商退款/红字发票在 5C 处理，5B 只记录退货事实？

---

## P6：批次 / 序列号 / 生产日期 / 有效期采集时机

**问题**：何时采集批次信息？

**CTO 倾向**：推荐在 **WarehouseReceipt（入库层）** 采集，只有合格入库才需要批次信息。

**子问题**：
- P6a：确认采集层（入库层 vs 收货层）？
- P6b：批次是否系统自动生成批号，还是允许手工录入？
- P6c：序列号管理是否第一版就要（建议按 Item 配置，第一版可先支持批次、序列号延后）？
- P6d：生产日期/有效期哪些 Item 需要（品类配置）？有效期预警放 6A/BI？

---

## P7：PO Line 收货投影口径

**问题**：PO Line `receivedQty / remainingReceiveQty` 的精确口径。

**子问题**：
- P7a：`receivedQty` = 到货口径（PurchaseReceipt 累计）？还是入库口径（WarehouseReceipt 累计）？建议：**到货口径**（收货层回写），入库口径另计（6A 或 5B 加 `stockedQty`）
- P7b：退货是否回退投影（见 P5d）？
- P7c：PO.status 何时 `RECEIVED`（到货全收 vs 入库全入 vs 无退货挂起）？

---

## P8：仓库 / 库位归属阶段

**问题**：Warehouse / Location 主数据哪一阶段建？

**选项**：
- A. 5B 先行最小 Warehouse 主档（收货/入库需要仓库维度）→ 6A 扩展库位/多仓
- B. 全部 6A 建，5B 只引用概念（第一版不落仓库字段）——**不推荐**，入库没仓库没意义
- C. 5B 建 Warehouse + Location 基础（参考 Supplier 主数据先例）

**建议**：C（5B 建最小 Warehouse/Location 主档，复用主数据模式；6A 扩展 Movement/Stock）。

---

## P9：库存增加触发点（红线确认）

**问题**：何时触发库存增加？

**已锁红线（CTO #6680）**：5B 可以定义"应产生库存动作"的业务事实，但不得直接把库存余额当事实写入；真正库存数量变化必须由 Sprint 6A `InventoryMovement` 统一承载。

**子问题**：
- P9a：确认触发事实 = WarehouseReceipt（采购入库事实）？还是质检合格时即触发？
- P9b：5B 与 6A 的衔接方式：5B 发布 `WarehouseReceiptCreated` 事件 → 6A 消费生成 InventoryMovement(IN)？还是 6A 实现时 WarehouseReceipt 直接驱动 Movement？（实现细节 Gate 后定）
- P9c：直送不产生 InventoryMovement(IN) 确认？

---

## P10：事件命名与注册

**问题**：5B 事件的精确命名与载荷。

**候选**（草案）：
- `PurchaseReceiptCreated`（收货）
- `WarehouseReceiptCreated`（入库——驱动 6A）
- `PurchaseReturnCreated`（退货）
- `PurchaseOrderPartiallyReceived` / `PurchaseOrderReceived`（PO 投影，ADR-0023 已预留）
- `GoodsReceived`（EVENTS.md 注明 5C 注册？还是 5B 注册？——**待拍板**：建议 5B 注册 PurchaseReceiptCreated，GoodsReceived 保留给 5C 供应商发票语境）

**子问题**：
- P10a：事件命名确认（GRN/收货/入库 中文语境与英文 eventType 对齐）
- P10b：载荷结构（对齐既有：含单据 id/code/来源/数量/操作人）

---

## 汇总表

| # | Pending | CTO 倾向（#6680） | 建议默认 | 状态 |
| --- | --- | --- | --- | --- |
| P1 | GoodsReceipt 定位 | 拆两层 | 方案 B（PurchaseReceipt + WarehouseReceipt） | 待拍板 |
| P2 | 超收容差 | 5% + 审批 | 5% 默认，超容差 Workflow 审批 | 待拍板 |
| P3 | 质检模式 | 免检/抽检/全检 | 按 Item 配置；待检=未入库 | 待拍板 |
| P4 | 直送 | 不入库 | Line 级标记 + projectId | 待拍板 |
| P5 | 退货 | 独立 PurchaseReturn | 独立事实；负 movement 留 6A | 待拍板 |
| P6 | 批次/效期采集 | 入库层 | WarehouseReceipt 采集 | 待拍板 |
| P7 | PO 投影口径 | — | receivedQty=到货口径；另计 stockedQty | 待拍板 |
| P8 | 仓库/库位阶段 | — | 5B 建最小 Warehouse/Location | 待拍板 |
| P9 | 库存触发 | 红线已锁 | WarehouseReceipt 驱动 6A Movement | 待拍板 |
| P10 | 事件命名 | — | 5B 注册 Receipt/WarehouseReceipt/Return | 待拍板 |

> CTO Design Review 拍板后：更新 ADR-0024 状态（Proposed → Accepted/Approved with Changes）→ 才允许 Schema + Migration 0023。
