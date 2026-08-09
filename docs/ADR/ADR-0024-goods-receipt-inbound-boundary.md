# ADR-0024：Goods Receipt & Inbound Boundary（收货与入库边界决策）

- 状态：**Proposed（草案，2026-08-09，待 CTO Design Review——Sprint 5B China ERP Process & Field Gate）**
- 关联：Sprint5B_China_ERP_Process_Field_Gate.md / Sprint5B_Field_Matrix.md / Sprint5B_CTO_Pending_Decisions.md / EVENTS.md / ADR-0023（5A 已 Implemented）
- 决策人：CIO（JINZA）提案 ｜ 审核：CTO
- 背景：Sprint 5A 已完成 PR/PO Foundation（PR #19 合并 main）。5B 需锁定"到货 → 收货 → 验收 → 入库"业务边界，回答 GoodsReceipt 到底代表什么；**本阶段只做 Design / ADR / 文档，禁止 Schema / Migration 0023 / API**（Gate 模式延续 Sprint 4/5 纪律）

## 核心决策（草案，CTO 倾向确认中）

### D1：到货/收货 与 采购入库 拆为两层事实（CTO #6680 倾向，推荐）

- **`PurchaseReceipt`（到货/收货事实）**：记录供应商实际送达（谁送的、到了什么、多少、送到哪、收货单号）；更新 PO Line 收货投影（receivedQty / remainingReceiveQty）；**不直接产生库存增加**
- **`WarehouseReceipt`（采购入库事实）**：记录"验收合格数量正式入库到仓库/库位"（仓库/库位、批次/序列号、生产日期/有效期、合格入库数量）；**是驱动 InventoryMovement(IN) 的业务事实**
- 理由：直送（只有 PurchaseReceipt 无 WarehouseReceipt）、质检待入库（Receipt 已建 Receipt 未建）、部分收货/部分入库（各自多次、各自 ceiling）、退货（独立 PurchaseReturn 与两层正交）——单一 GoodsReceipt 状态矩阵会压垮模型

### D2：只有 CONFIRMED PO 才是收货合法来源（5A 已锁，延续）

- 来源门禁：`PO.status = CONFIRMED / PARTIALLY_RECEIVED / RECEIVED` 才允许创建 PurchaseReceipt；DRAFT/SUBMITTED/APPROVED/CANCELLED 拒绝（对齐 ADR-0023 D2）
- 无 Direct GR（对齐无 Direct Delivery 锁定项）——收货必须挂在 PO 上

### D3：库存数量唯一事实源 = InventoryMovement（6A），5B 永不直接写库存

- **红线（CTO #6680 锁死）**：5B 可以定义"应产生库存动作"的业务事实（WarehouseReceipt），但不得直接把库存余额当事实写入（`stock.qty += x` 禁止）
- 真正库存数量变化必须由 Sprint 6A 的 `InventoryMovement` 统一承载；Stock = Movement 余额投影
- WarehouseReceipt 落库后发布事件（如 `WarehouseReceiptCreated`），6A 消费生成 InventoryMovement(IN)（衔接方式实现阶段定）

### D4：直送不进入仓库库存

- 直送链：`PO CONFIRMED → PurchaseReceipt / Inspection → Direct Delivery → 不进入 Warehouse Stock`
- 直送 = 有 PurchaseReceipt、无 WarehouseReceipt；不产生 InventoryMovement(IN)；消费/领用由项目侧另行记录

### D5：采购退货 = 独立 PurchaseReturn 事实（非负数 GR）

- `PurchaseReturn` 独立模型（Header + Lines），不做负数 GoodsReceipt
- 来源：质检拒收（未入库）/ 入库后退货（已入库，需 6A InventoryMovement(OUT)）/ 后续质量问题
- 是否允许技术层用"负 movement"表达退货 → **留到 Inventory Ledger（6A）设计时决定**（本阶段不拍）

### D6：PO Line 收货投影（5B 唯一回写方）

- PO Line 预留 `receivedQty=0 / remainingReceiveQty=quantity`（5A 已建列，禁客户端改）
- 5B 收货层每次 PurchaseReceipt 后回写：`receivedQty += 本次到货数量`；`remainingReceiveQty = quantity + 容差 - receivedQty`（服务端计算）
- 全部收完（且无退货挂起）→ PO status → `RECEIVED`；否则 `PARTIALLY_RECEIVED`（事件 `PurchaseOrderPartiallyReceived` / `PurchaseOrderReceived`）

### D7：超收容差与审批（Pending Decision P2 拍板后固化）

- 默认小容差（建议 5%）内允许超收；超出容差 → 拒绝或走 Workflow 审批（module 待定）
- 防超收红线：与 5A"GR 防超收 = PO Line 数量 ceiling"一致；锁内校验

### D8：边界红线（本阶段无越界实现）

- ❌ 不创建 Schema / Migration 0023 / Prisma model / API
- ❌ 不创建 Warehouse / Location / Stock / InventoryMovement 模型（属 6A）
- ❌ 任何代码不得直接写库存余额
- ❌ 不实现 Supplier Invoice / 三单匹配 / AP（5C）
- ❌ 不决定"负 movement 是否允许"（留 6A Inventory Ledger）

## Final Decisions（待 CTO Design Review 拍板）

| # | Pending | CTO 倾向（#6680） | 待确认 |
| --- | --- | --- | --- |
| ① | GoodsReceipt 定位 | 拆两层（PurchaseReceipt / WarehouseReceipt） | 模型命名与是否拆两层 |
| ② | 超收容差 | 允许小容差（建议 5%）+ 超容差审批 | 容差默认值、审批链 |
| ③ | 质检模式 | 免检/抽检/全检按 Item/Supplier | 待检库存是否表达 |
| ④ | 直送 | Direct Delivery 不入库，显式标记 | 判定字段 |
| ⑤ | 退货 | 独立 PurchaseReturn，非负 GR | 负 movement 留 6A |
| ⑥ | 批次/序列号/效期 | 入库层采集 | 采集时机确认 |
| ⑦ | 仓库/库位 | 5B 引用不新建（6A 建）或 5B 最小主档 | 归属阶段 |

> 完整 Pending 清单见 Sprint5B_CTO_Pending_Decisions.md（P1-P10）。
