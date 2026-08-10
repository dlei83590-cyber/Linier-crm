# Sprint 6B：CTO Pending Decisions（库存作业待拍板决策清单）

- 版本：v0.1（Design First，P1-P12 **全部待 CTO Design Review #7900 拍板**——本轮不擅自 Final）
- 日期：2026-08-11
- 维护者：CIO（JINZA）提案 ｜ 审核：CTO
- 关联：Sprint6B_Inventory_Operations_Architecture_Process_Gate.md / ADR-0026（Proposed）/ Sprint6B_Inventory_Operations_Field_Matrix.md / ADR-0025（6A Implemented）/ EVENTS.md（v1.26）

> **Gate 铁律（CTO #7895）**：6B 是库存作业领域——最容易污染 6A SSOT 的四种场景（Transfer 双边原子性、Count-Adjustment 事实边界、Conversion 守恒、绕过 Ledger Command 直写）。**Schema / Migration / API 继续 HOLD**——Design Review 通过后才放行。**P1-P12 本轮不要全部 Final**：每项给出推荐方案、备选方案、风险和 CTO Recommendation，交 Design Review 拍板。

---

## P1：Transfer 是同步双边 Ledger Command 还是 Outbox 驱动 —— ⏳ 待拍板

**问题**：Transfer 双边 Movement（SOURCE_OUT + DESTINATION_IN）的落账方式。

**推荐方案**：**同步双边 Ledger Command**——Transfer 业务事实 + SOURCE_OUT + DESTINATION_IN 同事务提交；调拨单 EXECUTED 成功 = 库存账双边已落定（无运输窗口）。6B 规模下同步更简单、更强一致；直接复用 6A 的维度锁/禁负库存/幂等逻辑（同事务内调用，不经过 Outbox）。

**备选方案**：Transactional Outbox 编组——业务事实 + N 个 atom Outbox 同事务，Consumer 逐 atom 幂等消费。风险：部分 atom 消费失败 → 编组暂不完整 → 需编组级完成检测/补偿（新增复杂度）；账务窗口取决于消费延迟（运输途中"凭空消失"窗口重新出现）。

**风险（推荐）**：同步长事务（双维度锁定）在并发高峰可能延长锁持有时间；但 Transfer 低频、维度锁范围小，可接受。

**CTO Recommendation 请求**：确认 **同步双边 Ledger Command**（不经过 Outbox），6A 现有 IN/OUT（入库/退货）维持 Outbox 不动。

---

## P2：Transfer 是否需要独立 Transfer Order / Transfer Document —— ⏳ 待拍板

**问题**：Transfer 是否建模为独立业务单据（TransferOrder/TransferDocument + 审批流），还是简化为一次动作（直接执行 + 审计记录）。

**推荐方案**：**独立 Transfer Document**（TransferHeader + TransferLine + 状态机 DRAFT/SUBMITTED/APPROVED/EXECUTED/CANCELLED）——对齐 5B 单据模式（创建即取号 TRF），支持跨仓调拨的审批与追溯；EXECUTED 才触发双边 Movement。

**备选方案**：无单据、直接 POST 执行（最小模型）。风险：无审批留痕、无法支持"已批准待执行"、审计弱；跨仓调拨通常需要业务审批。

**风险（推荐）**：多一层单据状态；但复用既有 DocumentSequence + Workflow 审批体系（5A/5B 已建），增量成本低。

**CTO Recommendation 请求**：确认 **独立 Transfer Document + 状态机**；是否需要 Workflow 审批（跨仓必审？同仓免审？）请一并拍板。

---

## P3：跨仓与同仓库位移动是否统一模型 —— ⏳ 待拍板

**问题**：INTER_WAREHOUSE 与 INTRA_WAREHOUSE（同仓不同库位）是否用同一 Transfer 模型/同一 Movement 结构。

**推荐方案**：**统一模型**——同一 Transfer Document + 同一组 Movement 结构（SOURCE_OUT + DESTINATION_IN，warehouseId 可同可异）；同仓移动 = 双边 warehouseId 相同、locationId 不同。区分只在字段语义（transferType），不拆分两套逻辑。

**备选方案**：分两套（同仓移动简化为单维度调整）。风险：两套逻辑、两种幂等/审计口径，且"同仓不同库位"本质仍是双边事实（源库位减、目标库位加），拆开会漏掉 location 维度守恒。

**风险（推荐）**：统一模型需保证同仓时源/目标维度不重叠（同一 location 移动自身 → 拒绝）；低风险。

**CTO Recommendation 请求**：确认 **统一模型**（transferType 区分，不拆两套）。

---

## P4：Transfer 是否允许负库存 —— ⏳ 待拍板（默认 NO）

**问题**：SOURCE_OUT 时源维度余额不足是否允许负库存。

**推荐方案**：**不允许负库存（默认 NO）**——SOURCE_OUT 在五维锁内检查 `onHandQty >= qty`，不足稳定拒绝（409），与 6A P6 Final 一致。Transfer 不制造负库存例外。

**备选方案**：允许负（如紧急调拨）。风险：破坏 6A 禁负库存 DB CHECK 与投影一致性；需单独豁免机制，污染 SSOT 语义。

**CTO Recommendation 请求**：确认 **不允许负库存**（与 6A 全局一致，无例外）。

---

## P5：Transfer serial/batch 精确继承规则 —— ⏳ 待拍板

**问题**：serial-managed / batch-managed 物料调拨时，序列号与批次如何继承。

**推荐方案（serial）**：**每 serial 一对 Movement、serialNo 精确继承不重生成**（SOURCE_OUT serialNo 取 X + DESTINATION_IN serialNo 取 X，quantity=1，五元 movementAtomKey 取 serialNo）；Transfer 行提交 serialNos 集合，数量守恒（len 与 quantity 相等），与 6A serial 原子化一致。
**推荐方案（batch）**：**批次精确继承**（SOURCE_OUT batchNo=B → DESTINATION_IN batchNo=B）；可选扩展：允许指定新批次（如拆批）——但 6B 首版建议只支持精确继承，拆批后续阶段做（避免第一版复杂度）。

**备选方案**：batch 允许任意重指定（如收货新批次）。风险：批次追溯断裂（来源批次丢失），5B P6 canonical capture 语义被破坏。

**CTO Recommendation 请求**：确认 **serial 精确继承 + batch 精确继承（首版不拆批）**；拆批是否明确 HOLD 到后续阶段。

---

## P6：Count snapshot/freeze 策略 —— ⏳ 待拍板

**问题**：盘点基准时点与盘点期间业务处理策略。

**推荐方案**：**动态盘点（不冻结维度）**——盘点单创建时取账面 snapshot（含 movementNo 水位 `snapshotWatermark`）；盘点期间该维度业务正常进行；完成时计算：`netVariance = (countedQty - bookQtySnapshot) + (盘点期间已入账 IN - OUT)`——**净差异才生成 ADJUSTMENT**，避免把正常业务 Movement 当差异。基准时点 = 盘点单创建时刻。

**备选方案**：① 冻结维度（盘点期间禁止该维度业务——强一致但业务中断）② 窗口可配置。风险：动态盘点需精确 replay 盘点期间 Movement（水位 + 时间窗过滤），实现复杂度略高；冻结方案简单但影响业务。

**风险（推荐）**：动态盘点下"盘点期间已入账"的计算必须基于水位精确过滤（含并发提交顺序）；可接受（Movement 有 committedAt + movementNo 单调）。

**CTO Recommendation 请求**：确认 **动态盘点 + snapshotWatermark + 净差异**；是否要求"盘点期间维度冻结"作为可配置选项。

---

## P7：Count variance 的审批阈值 —— ⏳ 待拍板

**问题**：差异（variance）多大需要审批，多大自动入账。

**推荐方案**：**阈值分级**——`|netVariance| <= 阈值A`（如单行差异 ≤ 5% 且 ≤ 数量上限）自动生成 ADJUSTMENT（记录 approvedBy=系统/盘点完成人）；超过阈值A → 需高权限审批（approvedBy 人工）后才生成 ADJUSTMENT；超过阈值B（如绝对值极大）→ 强制人工复核 + 二次盘点建议。阈值可配置（system-setting）。

**备选方案**：全部差异人工审批（最严）或全部自动（最松）。风险：全审批拖慢流程；全自动无防呆（重大差异可能是盘点错误/数据事故）。

**CTO Recommendation 请求**：确认 **阈值分级 + 可配置**；具体默认阈值（百分比/绝对值）请拍板或授权 CIO 定默认值。

---

## P8：Adjustment 权限与 reason code —— ⏳ 待拍板

**问题**：Adjustment 的授权模型与原因码清单。

**推荐方案**：**reasonCode 枚举 + 权限映射**——`COUNT_VARIANCE`（系统/盘点触发）/ `DAMAGE` / `LOSS` / `GIFT` / `SYSTEM_CORRECTION`（系统纠错）/ `MANUAL`（人工，最高权限）；权限：新受限权限 `inventory-adjustment:apply`（仅 SUPER_ADMIN/ADMIN，对齐 6A `inventory-ledger:consume` 的 SYSTEM_PERMISSIONS 模式）；MANUAL 需 approvedBy 二次授权 + 强审计（全部留 audit trail）。

**备选方案**：复用现有角色无新权限。风险：任何能调 Adjustment API 的角色都可改库存账——权限过宽，库存账被污染风险高。

**CTO Recommendation 请求**：确认 **新增受限权限 `inventory-adjustment:apply`（仅 SUPER_ADMIN/ADMIN）+ reasonCode 枚举映射**；reasonCode 清单是否照此（可增删）。

---

## P9：Adjustment 是否允许直接人工创建 —— ⏳ 待拍板（CTO 倾向：允许但高权限+强审计）

**问题**：人工创建 Adjustment（非盘点/系统触发）是否允许。

**推荐方案**：**允许，但高权限 + 强审计**（对齐 CTO 倾向）——`MANUAL` reasonCode 需 `inventory-adjustment:apply` 权限 + approvedBy 二次授权；全部字段必填（reasonCode/direction/quantity/dimensions/approvedBy/sourceReference）；幂等身份 = adjustmentNo+lineId+atomKey；serial-managed 人工调整仍逐 serial 原子化（不绕过 serial 守恒）；全部留审计轨迹（谁建、谁批、何时、为何）。

**备选方案**：禁止人工创建（只允许 Count/系统触发）。风险：紧急纠错（如系统错误导致账实不符）无通道，只能等下次盘点——运营僵化。

**风险（推荐）**：人工 Adjustment 是库存账污染最高风险入口——靠权限（受限）+ 审计（全留痕）+ 幂等（防重）三重约束控制。

**CTO Recommendation 请求**：确认 **允许但高权限+强审计**；权限落地方式（新受限权限 vs 复用现有）请拍板。

---

## P10：Conversion 多输入/多输出模型 —— ⏳ 待拍板

**问题**：Conversion 输入/输出数量关系建模。

**推荐方案**：**多输入 × 多输出编组**——ConversionHeader 一个 movementGroupId；ConversionLine 带 `lineRole`（CONSUME/PRODUCE）；N 输入 → M 输出（2→1、1→3 均支持）；全部 CONSUME + PRODUCE 同事务原子提交（同步 Command，P1 对齐）；每行五元幂等（movementAtomKey 取 BULK 或 serialNo）；输入输出守恒校验（换算后 ΣCONSUME 与 ΣPRODUCE 相等，P11）。

**备选方案**：固定 1:1 或 1:N（一个输入行 → 多个输出行）。风险：无法表达"多原料合成一产品"（制造业常见）——模型过窄，后续返工。

**CTO Recommendation 请求**：确认 **多输入 × 多输出编组模型**；输出是否允许跨仓库/库位（各行独立维度）。

---

## P11：Conversion UOM 与数量守恒口径 —— ⏳ 待拍板

**问题**：输入/输出 UOM 不同（如 KG→PC）时，守恒怎么算。

**推荐方案**：**UOM 基换算守恒**——每个 Conversion 声明 `uomRelation`（输入 UOM ↔ 输出 UOM 换算率，或统一到 baseUom）；守恒校验：`Σ(输入 quantity × 输入→base 换算) = Σ(输出 quantity × 输出→base 换算)`；Movement 各自记录业务 UOM 与 quantity（不改 6A Movement 语义）；换算率存 Conversion 头，审计可见。

**备选方案**：要求输入输出同 UOM（不许换算）。风险：无法表达真实转换场景（原料按 KG、成品按 PC），模型实用性差。

**风险（推荐）**：换算率错误会引入数量误差——需换算率来源受控（UoM 换算表或单据显式声明 + 审批）；首版建议**单据显式声明换算率**（不隐式查表）。

**CTO Recommendation 请求**：确认 **UOM 基换算守恒 + 单据显式换算率**；换算率来源（UoM 表 vs 单据声明）请拍板。

---

## P12：Operations 是否全部复用现有 Outbox/Consumer，还是同步 Ledger Command 与异步 Consumer 分层 —— ⏳ 待拍板

**问题**：6B 四类 Operations 与 6A Outbox/Consumer 架构的关系。

**推荐方案**：**分层**——① **Transfer / Adjustment / Conversion → 同步 Ledger Command**（同事务落 Movement，复用 6A 维度锁/禁负/幂等核心逻辑，封装为 command 函数，不经过 Outbox）；② **Count → 业务事实落库（异步 Outbox 可选，仅发 `InventoryCountCompleted` 业务事件）**，差异经 Adjustment Command 同步处理；③ **6A 现有 IN/OUT（入库/退货）维持 Transactional Outbox + Consumer 不动**（6A FINAL APPROVED 零改造）。同步 Command 与 Outbox 消费共用同一套"原子落 Movement + 投影 + 幂等"底层（抽出共享 command 核心，避免双实现分叉）。

**备选方案**：Operations 全部走 Outbox 编组。风险：编组完成检测/补偿复杂度 + 账务窗口（P1 已述）。

**风险（推荐）**：同步 Command 与 Outbox Consumer 需共享底层以避免逻辑分叉——设计上抽 `InventoryLedgerCommand` 共享层（6B 实现阶段落地，本轮只锁原则）。

**CTO Recommendation 请求**：确认 **分层（同步 Command + Outbox 维持 6A 不动）**；共享 Ledger Command 核心的抽取是否在 6B 实现阶段做（还是 6A 现有 consumer 内函数直接复用、不抽取新层）。

---

## 汇总表（待 CTO Design Review #7900 拍板）

| # | Pending | CIO 推荐 | 备选 | CTO 拍板 |
| --- | --- | --- | --- | --- |
| P1 | Transfer 落账方式 | **同步双边 Ledger Command** | Outbox 编组 | ⏳ |
| P2 | Transfer 是否独立单据 | **独立 Transfer Document + 状态机** | 无单据直执行 | ⏳ |
| P3 | 跨仓/同仓统一模型 | **统一模型**（transferType 区分） | 两套逻辑 | ⏳ |
| P4 | Transfer 负库存 | **不允许（默认 NO，6A 一致）** | 允许负+豁免 | ⏳ |
| P5 | serial/batch 继承 | **精确继承，不拆批** | batch 可重指定 | ⏳ |
| P6 | Count snapshot/freeze | **动态盘点 + snapshotWatermark + 净差异** | 冻结维度 | ⏳ |
| P7 | Count variance 审批阈值 | **阈值分级 + 可配置** | 全审批/全自动 | ⏳ |
| P8 | Adjustment 权限/reason code | **新受限权限 inventory-adjustment:apply + reasonCode 枚举映射** | 复用现有角色 | ⏳ |
| P9 | Adjustment 人工创建 | **允许但高权限+强审计**（CTO 倾向确认） | 禁止人工 | ⏳ |
| P10 | Conversion 多输入/多输出 | **多输入 × 多输出编组** | 固定 1:N | ⏳ |
| P11 | Conversion UOM 守恒 | **UOM 基换算守恒 + 单据显式换算率** | 同 UOM 限制 | ⏳ |
| P12 | Outbox vs 同步分层 | **分层：Transfer/Adj/Conversion 同步 Command；Count 事实落库；6A IN/OUT 维持 Outbox 不动** | 全 Outbox 编组 | ⏳ |

> **四条库存账红线对应**：P1/P3/P4/P5（Transfer 双边原子性 + 禁负 + 继承）、P6/P7（Count-Adjustment 事实边界 + 阈值）、P10/P11（Conversion 守恒）、P8/P9/P12（严格经 Ledger Command，不绕过 SSOT）。**Reservation / Costing 全程不进入 6B Gate。**
