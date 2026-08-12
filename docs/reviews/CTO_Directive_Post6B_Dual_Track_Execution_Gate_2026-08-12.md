# CTO Development Directive — Post-6B Dual-Track Execution Gate

- Directive Date: 2026-08-12
- Baseline: main @ 874e060
- Priority: P0
- Execution Mode: Dual Track
- Authority: CTO Architecture / Delivery Gate
- 存档：CIO 2026-08-12（依据 CTO PDF 原版转录，作为仓库事实源）

---

## 1. 当前总体决策

项目正式进入 **Post-6B 双轨执行阶段**。不再按"等待整个后端全部完成后再做前端"的串行模式推进。两条主线并行：

- **Track A — Frontend Productization**（PR #24 `feature/frontend-operations-workspace`）：将已 FINAL 的 Purchase / Inventory Operations 后端能力转化为真实可操作工作台。
- **Track B — Supplier Invoice / AP Accounting**（PR #23 `feature/sprint5c-supplier-invoice-ap`）：完成 Purchase → Warehouse Receipt → GRIR → Supplier Invoice → AP 的会计事实闭环。

两条 Track 可并行开发，但必须严格遵守领域边界。

## 2. 全局优先级

- **P0 — Sprint 5C-1C Accounting Closure**：GRIR Producer → Supplier Invoice POST → GRIR CONSUME → AP Liability → AP Open Item
- **P0 — Frontend Operations Iteration 1**：完成已有 FINAL API 的 10 个业务模块列表工作台
- **P1 — Inventory Read Model Gate**：StockProjection Query API + InventoryMovement Query API
- **P1 — Portfolio / Release Governance**：ROADMAP / Sprint Status / Release Baseline 同步
- **HOLD（除非 CTO 单独解除）**：Inventory Reservation、AvailableQty、FIFO、Moving Average、Inventory Costing、General Ledger、Financial Statements、BI、OA、Mobile

## 3. Track B — Sprint 5C-1C

当前最高后端优先级。PR #23，当前阶段 5C-1C0 Accounting Readiness。

### 3.1 C0 当前任务

首先完成并冻结 **GRIR Producer Foundation**：

- Warehouse Receipt POST 必须**原子产生 GRIR ACCRUAL**，与 WHR POST 同一事务边界。不得出现"WHR 已 POSTED 但 GRIR ACCRUAL 不存在"。
- Purchase Return RETURN（sourceRefType = WAREHOUSE_RECEIPT_LINE）必须产生 **GRIR REVERSAL**。
- 保证 Σ REVERSAL ≤ Σ ACCRUAL；任何并发路径不得制造负 GRIR。

## 4. Migration 0027 / 0028 决策

- **Migration 0027**：继续 FROZEN BASELINE，禁止修改。任何后续问题不得通过回改 0027 解决。
- **Migration 0028**：定位为 Historical GRIR Backfill Migration。允许完成本轮 Required Hardening，但一旦通过 Final Gate 立即冻结。
- 0028 必须保证：historical ACCRUAL backfill、historical REVERSAL backfill、canonical sourceKey、idempotency、no negative GRIR、source business timestamp preservation。
- 禁止：新业务模型、偷带 AP Posting、偷带 Supplier Invoice 状态迁移、修改 0027 schema。

## 5. 5C-1C1 — Supplier Invoice POST

C0 Final 后立即进入 C1。POST 是本阶段最重要的会计 Gate。POST 前必须重新验证：

Invoice 当前状态合法 / Approval reference 合法 / Match 已完成 / Match immutable / Supplier 一致 / Item 一致 / PO Line 一致 / WHR Line 一致 / WHR = POSTED / matched quantity 合法 / tax basis 合法 / GRIR remaining quantity 足够。

**禁止信任**：client amount、client tax、client matched quantity、client AP amount。所有金额必须 Server-side Decimal canonical calculation。

## 6. GRIR CONSUME

- Supplier Invoice POST 必须生成 GRIR CONSUME。
- GRIR 必须保持 Immutable Accounting Fact：禁止 `UPDATE GrirRecord SET quantity = ...`。
- 正确模式只有：ACCRUAL / REVERSAL / CONSUME。未来纠错通过新增事实完成。

## 7. AP Liability

- Invoice POST 成功时，同事务产生 ApLiabilityFact 并创建 ApOpenItem。
- 必须保证：Invoice POST 成功 ⇔ GRIR Consume + AP Liability + AP Open Item 全部成功。禁止 partial success。
- 事务边界（建议）：SupplierInvoice POST → lock source WHR lines → recompute GRIR remaining → create GRIR CONSUME → create AP Liability Fact → create AP Open Item → Invoice → POSTED → commit。

## 8. 并发锁序

本轮锁序正式升级为系统级 Accounting Invariant。Invoice POST 与 Purchase Return REVERSAL 对 WHR Lines 必须采用完全一致的 deterministic locking：

collect IDs → deduplicate → sort → `SELECT ... ORDER BY id FOR UPDATE` → calculate remaining GRIR。

禁止：输入顺序锁、Prisma findMany 返回顺序锁、单行循环随机锁、POST / Return 使用不同锁序。**这是 Blocking Gate。**

## 9. AP 本阶段边界

5C-1 当前只建立：Supplier Invoice、3-Way Match、GRIR、AP Liability、AP Open Item。

继续 HOLD：Supplier Payment、AP Allocation、Payment Reversal、Supplier Credit Note、Supplier Debit Note、AP Write-Off、GL Posting。不要为"看起来闭环"把 5C-2 / Sprint 7 偷进 5C-1。

## 10. Track A — Frontend Operations

PR #24。现有 IA / Route / Contract / State / Permission 基础接受。下一阶段正式进入 Frontend Iteration 1：禁止继续只增加 Placeholder，目标变为可消费真实 FINAL API 的业务列表页。

## 11. Frontend Iteration 1 范围

只允许以下 10 个模块：

1. Purchasing：Purchase Requisition、Purchase Order、Purchase Receipt、Inspection、Warehouse Receipt、Purchase Return
2. Inventory Operations：Inventory Transfer、Stock Count、Inventory Adjustment、Inventory Conversion

每个模块第一阶段只要求：List / Search / Filter / Pagination / Status / Basic Navigation。不要同时做完整 CRUD。

## 12. Frontend 横切基础

禁止十个页面复制十套 fetch/error/loading 逻辑。先建立最小共享层：API client、typed response handling、pagination contract、loading state、empty state、error state、permission denied state、status badge、date/number formatting。

但禁止过度设计"大一统前端框架"。原则：**至少两个真实模块证明重复以后，才抽象**。

## 13. Frontend 状态机红线

UI 必须忠实表达后端事实。禁止把不同状态合并成"用户看起来差不多"。必须保持：

APPROVED ≠ CONFIRMED、CREATED ≠ POSTED、APPROVED ≠ APPLIED、COMPLETED ≠ ADJUSTED、DRAFT ≠ SUBMITTED。

前端按钮显隐只能消费后端状态契约。禁止前端发明业务状态。

## 14. Stock Projection / Inventory Ledger

继续 HOLD。当前两个页面只能保持 Placeholder。禁止：调多个 API 自己拼余额、SUM InventoryMovement 得出权威库存、客户端重建 StockProjection、添加虚构权限、临时读取数据库、添加非 FINAL 私有 API。直到 Backend Read Model Gate FINAL。

## 15. Backend Read Model Gate

允许作为独立 P1 小 Gate 开始设计，但必须与 PR #24 解耦。不得为了前端页面直接在 Frontend PR 中新增后端 API。

- **Stock Projection Query**：只读。建议维度 item / warehouse / location / batch / serial；支持 pagination、filtering、item search、warehouse filter、location filter、batch filter。返回值必须来自 StockProjection SSOT。禁止 route 动态 SUM InventoryMovement 作为正式余额实现。
- **Inventory Movement Query**：只读审计流水。支持 item / warehouse / location / movementType / sourceType / sourceId / movementGroupId / date range。是 Trace / Audit Query，不是库存余额 API。

## 16. Reservation / Costing 红线

Backend Read Model Gate 不得借机引入：reservedQty、availableQty、unitCost、inventoryValue、FIFO layer、movingAverageCost。这些属于未来独立领域 Gate。当前 StockProjection 仍然只表达已经 FINAL 的 quantity fact。

## 17. PR 策略

禁止继续扩大巨型 PR。

- Track B：PR #23 只负责完成 5C-1。达到 Final Gate 后立即关闭/合并。5C-2 必须新 PR。
- Track A：PR #24 完成当前 Frontend Operations 既定范围后关闭。不要把 Supplier Invoice UI、Dashboard、Inventory Read Model backend、Finance UI 继续塞入 #24。

## 18. Main Merge Gate

任何 PR 合并 main 前必须满足：GitHub CI GREEN、Blocking = 0、Contract documented、State transition documented、Error code registered、Permission aligned、Event registered（如适用）、Migration reviewed（如适用）、concurrency invariant reviewed（如适用）、idempotency reviewed（如适用）。

**CI GREEN 是必要条件，但不是充分条件。业务不变量错误不能因为 CI GREEN 而合并。**

## 19. 本地验证政策

继续执行 **CI-FIRST / NO LOCAL SERVER**。禁止为了验证：启动完整 Web Server、启动长期 dev server、启动本地数据库服务、重复执行高负载 build/test。

允许：静态代码检查、小范围文件检查、schema/diff review、Git 操作。最终验证事实源：GitHub Actions CI。

**如果仓库文档仍存在与此冲突的旧规则，本轮 Governance Task 必须统一。**

## 20. Roadmap Governance

当前 ROADMAP 已明显落后于代码事实。安排一个独立文档治理 commit，更新至少：

- Sprint 5A → FINAL、Sprint 5B → FINAL、Sprint 6A → FINAL、Sprint 6B → FINAL
- Sprint 5C-1 → ACTIVE、Frontend Operations → ACTIVE、Inventory Read Model → PLANNED
- Reservation → HOLD、Costing → HOLD、Sprint 7 GL → HOLD until AP foundation

禁止在 ROADMAP 中把尚未 FINAL 的能力写成 DONE。

## 21. Release Gate

正式版本当前不应长期停留在 v0.6.0-alpha。下一次 Alpha Release Gate 从现在开始准备。候选条件：5C-1 FINAL + Frontend Operations Iteration 1 达到可用基线。之后建立新的正式 release baseline。Archive tag 不能代替产品 Release。Release 必须明确：schema baseline、migration baseline、API baseline、frontend baseline、known limitations、HOLD capabilities。

## 22. 当前禁止事项

未经 CTO 新指令，禁止：开始 GL、开始 Inventory Costing、开始 Reservation、开始 BI、开始 OA、开始 Mobile、前端自己计算库存余额、修改 Migration 0027、修改 immutable accounting facts、绕过 Shared Inventory Ledger、client-side canonical amount calculation、approval 直接等同 posting、巨型跨领域 PR、因 UI 需求反向污染后端事实模型。

## 23. 下一次 CTO Gate

下一次正式 Gate 不看"写了多少代码"，只检查三个结果：

- **Gate A — Accounting**：证明 WHR POST → GRIR ACCRUAL → Supplier Invoice Match → Supplier Invoice POST → GRIR CONSUME → AP Liability → AP Open Item 在 transaction / concurrency / idempotency / historical data 四个维度均成立。
- **Gate B — Frontend**：至少证明真实 FINAL API 已被工作台稳定消费。要求 permission / loading / error / empty / pagination / status 正确。
- **Gate C — Governance**：证明 ROADMAP 与 main 一致、Release baseline 清晰、CI policy 清晰、HOLD 边界清晰。

## CTO Final Decision

- **Track A：CONTINUE** — Frontend Operations Iteration 1 正式继续，只消费 FINAL contracts。
- **Track B：CONTINUE — P0** — 5C-1C Accounting Closure 为当前最高后端优先级。
- **Inventory Read Model：DESIGN START / IMPLEMENTATION HOLD UNTIL CONTRACT REVIEW** — 允许开始 Query Contract 设计，不允许未经 Gate 直接接入前端。
- **Reservation：HOLD**；**Inventory Costing：HOLD**；**Sprint 7 GL：HOLD**；**BI / OA / Mobile：HOLD**。

当前唯一目标：把已建立的 Purchase + Inventory 事实链稳定接入 AP Accounting，同时把已 FINAL 的业务能力转化成真正可操作的 Frontend Workspace。

**下一阶段成功标准**：Accounting facts close correctly. Existing backend becomes usable. No domain boundary regression.
