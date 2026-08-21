# CreditDebitNote / InvoiceAdjustment API 测试用例（Sprint 4E-3 Credit Note / Debit Note）

> 模块：Credit Note / Debit Note Foundation（发票调整与应收调整领域）
> 关联：docs/qa/Sprint4E3_QA.md、ADR-0022、Sprint4E3_CreditDebitNote_Design.md、API_GUIDELINES.md、ERROR_CODES.md、EVENTS.md v1.12
> 说明：覆盖 4 端点（POST/GET /api/credit-debit-notes、POST /{id}/submit、POST /{id}/apply）；重点覆盖 CTO 财务边界锁死：
> **CN/DN 不修改原 Invoice 金额事实**（invoiceTotal/行快照/InvoiceSnapshot 不动）、**APPROVED ≠ APPLIED**（Apply 唯一改 AR.adjustedAmount 入口）、
> **只有 Apply 创建 InvoiceAdjustment**（客户端禁直接创建，只读）、**CN<0 / DN>0 signed 符号口径**（全系统唯一）、
> **负 AR = Customer Credit projection**（不新增 CREDIT 状态，禁 Receipt Allocation / WriteOff）；以及 **Concurrency（锁序 InvoiceLine id ASC FOR UPDATE 防超调/防穿透）**、
> Quantity/Amount ceiling（累计防超调锁内重算，同类型聚合 CN/DN 不互相污染）、Projection consistency（AR 事实源 / Invoice 余额投影）、
> Workflow（CREDIT_DEBIT_NOTE 条件审批）、Boundary（Decimal 全程、快照 toString）。

## A. 认证与权限（Auth / RBAC）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 | POST /api/credit-debit-notes | 401 AUTHENTICATION_ERROR |
| A2 | 无 credit-debit-note:create | POST /api/credit-debit-notes | 403 FORBIDDEN |
| A3 | 无 credit-debit-note:view | GET /api/credit-debit-notes | 403 |
| A4 | 无 credit-debit-note:edit | POST /api/credit-debit-notes/:id/submit | 403 |
| A5 | 无 credit-debit-note:approve | POST /api/credit-debit-notes/:id/apply | 403 |
| A6 | 有 create 无 edit | 创建成功但 submit | 403（submit 需要 edit） |
| A7 | 有 edit 无 approve | submit 成功但 apply | 403（apply 需要 approve） |
| A8 | credit-debit-note-line:view | GET 列表含 lines | 有 view 可读 lines；无 view 403 |
| A9 | invoice-adjustment:view | 只读场景 | 有 view 可读；**无 create/edit 权限码（系统事实层只读）** |
| A10 | invoice-adjustment 无 create | POST /api/invoice-adjustments（不存在） | 404/405（未实现，禁直接创建） |
| A11 | SUPER_ADMIN 全权限 | 创建+submit+apply | 全部成功 |
| A12 | 权限码 seed 存在性 | credit-debit-note:view/create/edit/approve + line:view/edit + adjustment:view | seed 后 permission 表存在 |

## B. 端点存在性 / 边界（Endpoint / Boundary）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | CreditDebitNote 无 PATCH | PATCH /api/credit-debit-notes/:id | 404/405（金额/状态受控事务驱动） |
| B2 | CreditDebitNote DELETE（状态门禁） | DELETE /api/credit-debit-notes/:id | DRAFT/CANCELLED/REVERSED → 200 软删；APPLIED → 409（先反冲）；SUBMITTED → 409（先取消）；不存在 → 404 CN_DN_NOT_FOUND |
| B3 | InvoiceAdjustment 无独立端点 | /api/invoice-adjustments 任意方法 | 404（事实由 Apply 事务生成，客户端不可直接访问） |
| B4 | 列表空数据 | GET /api/credit-debit-notes（无数据） | 200 空数组 + meta |
| B5 | 分页默认 | GET（无参数） | page=1 pageSize=20 |
| B6 | 分页边界 | GET ?pageSize=500 | 钳制 100 |
| B7 | status 过滤 | GET ?status=SUBMITTED | 只返回 SUBMITTED |
| B8 | noteType 过滤 | GET ?noteType=CREDIT | 只返回 CREDIT |
| B9 | customerId 过滤 | GET ?customerId=X | 只返回该客户 |
| B10 | 软删除隔离 | deletedAt 记录 | 不出现在列表 |
| B11 | apply 不存在 Note | POST /api/credit-debit-notes/:badId/apply | 404 CN_DN_NOT_FOUND |
| B12 | submit 不存在 Note | POST /api/credit-debit-notes/:badId/submit | 404 CN_DN_NOT_FOUND |
| B13 | 请求体非法 JSON | POST create（坏 JSON） | 400 VALIDATION_ERROR |
| B14 | 列表只读语义 | GET 返回不含审计敏感字段 | 只读投影，无 PATCH 入口 |

## C. CreditDebitNote 创建（Create）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| C1 | CREDIT 创建成功 | POST create {noteType:CREDIT, sourceInvoiceId, reason, lines:[{sourceInvoiceLineId,quantity:60}]} | 201；code=CN-2026-xxxx；status=DRAFT；adjustmentTotal=Σ lines（服务端计算） |
| C2 | DEBIT 创建成功 | POST create {noteType:DEBIT,...} | 201；code=DN-2026-xxxx |
| C3 | 编号创建即取号 | 连续创建 CN×2 | code 递增（CN-2026-000001 → 000002） |
| C4 | CN/DN 独立序列 | 交替创建 CN/DN | CN-/DN- 各自独立递增 |
| C5 | noteType 必填 | 无 noteType | 400 |
| C6 | noteType 非法 | noteType=REFUND | 400（枚举校验） |
| C7 | sourceInvoiceId 必填 | 无 | 400 |
| C8 | reason 必填 | 无 reason | 400 |
| C9 | lines 必填 | 无 lines | 400（minItems 1） |
| C10 | quantity=0 | lines quantity=0 | 400（positive 校验） |
| C11 | quantity 负数 | lines quantity=-10 | 400 |
| C12 | **Create 不落 InvoiceAdjustment** | 创建后查 InvoiceAdjustment | 无新增（T1——边界③） |
| C13 | **Create 不改 AR** | 创建后查 AR | adjustedAmount/balanceAmount 不变（边界①③） |
| C14 | **Create 不改 Invoice.balanceAmount** | 创建后查 Invoice | balanceAmount 不变（边界①） |
| C15 | 行金额快照复制 | 创建后查 lines | unitPrice/discountRate/lineAmount/taxAmount/totalAmount == 原 InvoiceLine 快照（不重算、不调 Pricing Engine） |
| C16 | 行描述快照复制 | 创建后查 lines[0].description | == InvoiceLine.description |
| C17 | itemId/uomId 继承 | 创建后查 lines | itemId/uomId 继承原行（可空） |
| C18 | changeReason 可选 | 带 changeReason | 201（写入审计 afterData） |

## D. 源发票 / 行校验（Source Invoice / Line validation）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| D1 | 源 Invoice 不存在 | sourceInvoiceId=badId | 409 CN_DN_SOURCE_INVOICE_INVALID |
| D2 | 源 Invoice 非 ISSUED（DRAFT） | sourceInvoiceId=DRAFT 发票 | 409 CN_DN_SOURCE_INVOICE_INVALID（只接受 ISSUED） |
| D3 | 源 Invoice 非 ISSUED（CANCELLED） | sourceInvoiceId=CANCELLED | 409 CN_DN_SOURCE_INVOICE_INVALID |
| D4 | 行不属于该 Invoice | sourceInvoiceLineId 属于其他发票 | 409 CN_DN_SOURCE_LINE_INVALID |
| D5 | 行不存在 | sourceInvoiceLineId=badId | 409 CN_DN_SOURCE_LINE_INVALID |
| D6 | 多行部分非法 | lines 中一行非法 | 409 CN_DN_SOURCE_LINE_INVALID（整体拒绝） |
| D7 | 单票制：禁止跨票 | 第二张 CN 引用同一 Invoice | 允许（多 CN 同票 OK——防超调由累计校验管）；**禁止单 Note 跨票**（sourceInvoiceId 单值） |
| D8 | 同行重复引用 | lines 两个 sourceInvoiceLineId 相同 | 允许（各自一行）或按实现校验；不重复创建事实 |
| D9 | Customer/Currency 继承 | 创建后查 note | customerId/currency == Invoice 值（客户端传了也忽略） |
| D10 | 客户端传 customerId 被忽略 | POST 带 customerId | 201 但 note.customerId 仍 = Invoice.customerId |
| D11 | 客户端传金额被忽略 | POST 带 unitPrice/lineAmount 等 | 201 但行金额 = 快照复制（禁止客户端直传） |
| D12 | 快照完整性 | 原行快照字段齐全 | 所有行字段非空（description/quantity/unitPrice/...） |

## E. Submit（auto-approve：移除审核，提交即生效）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| E1 | DRAFT → SUBMITTED 成功 | POST /{id}/submit | 200；status=SUBMITTED；approvalStatus=APPROVED + approvedAt/approvedById=提交人；workflowTriggered=false、workflowSkipped='no-policy' |
| E2 | 非 DRAFT 提交 | APPLIED Note submit | 409 CN_DN_INVALID_STATE |
| E3 | CANCELLED Note submit | CANCELLED Note submit | 409 CN_DN_INVALID_STATE |
| E4 | 重复 Submit | SUBMITTED 后再 submit | 409 CN_DN_INVALID_STATE（仅 DRAFT 可提交，CAS status=DRAFT） |
| E5 | 不创建 WorkflowInstance | submit 后查询 | 无 credit-debit-note 实例；workflowInstanceId=null（可直接 Apply——apply 门禁 status=SUBMITTED + workflowInstanceId==null 放行） |
| E7 | **Submit 不改 AR.adjustedAmount** | submit 前后查 AR | adjustedAmount/balanceAmount 不变（T2——边界②） |
| E8 | **Submit 不创建 InvoiceAdjustment** | submit 后查 | 无新增（边界③） |
| E9 | 并发防双提交 | 并发两次 submit | 仅一次成功；第二次 409 CN_DN_INVALID_STATE（updateMany status=DRAFT CAS） |
| E12 | changeReason 写入审计 | submit 带 changeReason | 审计 afterData 含 changeReason |

## F. Apply（Apply 事务）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| F1 | CREDIT Apply 成功 | SUBMITTED CREDIT → apply | 201；status=APPLIED；appliedAt/appliedById 写入 |
| F2 | DEBIT Apply 成功 | SUBMITTED DEBIT → apply | 201；status=APPLIED |
| F3 | 非 SUBMITTED Apply | DRAFT Note apply | 409 CN_DN_INVALID_STATE |
| F4 | APPLIED 后 Apply | 已 APPLIED 再 apply | 409 CN_DN_ALREADY_APPLIED（幂等稳定 409） |
| F5 | 命中审批未 APPROVED Apply | PENDING Note apply | 409 CN_DN_APPROVAL_REQUIRED |
| F6 | 命中审批 APPROVED 后 Apply | COMPLETED → APPROVED → apply | 201（APPROVED ≠ APPLIED，Apply 才生效） |
| F7 | 未命中策略直接 Apply | 无策略 SUBMITTED → apply | 201（可直接进入可 Apply 状态） |
| F8 | **Apply 创建 InvoiceAdjustment** | apply 后查 | 每行一条 fact（signed），appliedAt 非空（T4——边界③） |
| F9 | AR.adjustedAmount 聚合 | apply 后查 AR | adjustedAmount = 原值 + Σ signed adjustmentAmount |
| F10 | AR.balanceAmount 重算 | apply 后查 AR | balanceAmount = computeBalance(original, newAdjusted, paid, writeOff) |
| F11 | **Invoice.balanceAmount = AR newBalance** | apply 后查 Invoice | == AR.balanceAmount（直写投影，T12） |
| F12 | AR Revision 生成 | apply 后查 | revisionNo 递增，snapshotData 含四金额+balance |
| F13 | AR Snapshot(ADJUSTMENT) | apply 后查 | snapshotType=ADJUSTED、snapshotSource=ADJUSTMENT |
| F14 | 事件双发 | apply 后查审计 | InvoiceAdjustmentApplied + AccountsReceivableAdjusted（事务外，失败降级） |
| F15 | customer/currency 不一致 Apply | Note.customerId ≠ AR.customerId | 409 CN_DN_SOURCE_NOT_COMPATIBLE |
| F16 | 部分行 Apply | 多行 Note apply | 每行一条 fact，AR 聚合 Σ |
| F17 | 同票多 Note 顺序 Apply | CN#1 apply → CN#2 apply | 各自创建 fact，AR.adjustedAmount 累计 |
| F18 | changeReason 写入快照 | apply 带 changeReason | AR Revision snapshotData.changeReason 非空 |

## G. Signed Adjustment（符号口径——CTO 98/100 全系统唯一）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| G1 | **CREDIT → adjustmentAmount < 0** | CREDIT apply 后查 InvoiceAdjustment | adjustmentAmount 为负（T5） |
| G2 | **DEBIT → adjustmentAmount > 0** | DEBIT apply 后查 | adjustmentAmount 为正（T6） |
| G3 | CN 减少 AR.adjustedAmount | CREDIT apply | adjustedAmount 变小（负向聚合） |
| G4 | DN 增加 AR.adjustedAmount | DEBIT apply | adjustedAmount 变大（正向聚合） |
| G5 | 部分行比例折算 | 原行 100（total 1000）、CN 60 | fact.adjustmentAmount = -600（60% 按数量比例，不重算） |
| G6 | 多行混合符号 | CN 多行 | Σ signed（全部负向） |
| G7 | 请求输入正数 | 客户端传正数 | 落库强制 signed（CN 负/DN 正），禁止混合语义 |
| G8 | adjustmentAmount Decimal 精度 | 比例折算结果 | Decimal(18,4)，无 Float/Number 中间转换 |

## H. Quantity Ceiling（数量上限——累计防超调）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| H1 | 单张 CN 数量 ≤ 原行 | 原行 100、CN 60 | 201/201（合法） |
| H2 | 单张 CN 数量 > 原行 | CN 120 | 409 CN_DN_QUANTITY_EXCEEDED |
| H3 | **多张 CN 累计防超调** | CN#1=60 Apply ✅ → CN#2=60 Apply | CN#2 409（remaining=40，T7） |
| H4 | 累计恰好等于原行 | CN#1=60 + CN#2=40 | 两张都成功（累计 100=原行） |
| H5 | 累计超过原行 | CN#1=60 + CN#2=50 | CN#2 409 |
| H6 | 未 Apply 的 CN 不占额度 | CN#1=60（DRAFT/SUBMITTED 未 apply）+ CN#2=60 apply | CN#2 成功（只聚已 APPLIED） |
| H7 | Reversed 的 CN 不占额度 | CN#1 apply 后 reverse + CN#2 | CN#2 成功（只聚未 reversed） |
| H8 | 不同行独立额度 | 行 A CN60 + 行 B CN60 | 各自独立校验，均成功 |

## I. Amount Ceiling（金额上限——累计防超调）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| I1 | **DN 累计金额 ≤ 原行金额** | 原行 1000、DN 600 | 201（合法） |
| I2 | **DN 累计超过原行金额** | DN#1=600 Apply ✅ → DN#2=600 Apply | DN#2 409 CN_DN_AMOUNT_EXCEEDED（ceiling=1000，T9） |
| I3 | DN 恰好等于原行金额 | DN 1000 | 201（≤ ceiling） |
| I4 | **CN/DN 同类型独立累计** | CN=-600 后 DN=+600 | DN 累计 600+600=1200 > 1000 → 409（同类型聚合，T10） |
| I5 | CN 金额累计 | CN#1=-600 Apply → CN#2=-600 | CN#2 409（CREDIT 累计 abs 1200 > 1000） |
| I6 | CN 金额累计不污染 DN | CN=-600 后 DN=+400 | DN 累计 400 ≤ 1000 → 201（CN 不计入 DN ceiling） |
| I7 | 部分行金额 ceiling | 原行 1000、DN 60%（600）| 201（按比例折算 600 ≤ 1000） |
| I8 | 跨行金额独立 | 行 A DN600 + 行 B DN600 | 各自 ceiling 独立，均成功 |

## J. Negative AR（负应收 = Customer Credit projection）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| J1 | **全额付款后 CN → AR 负余额** | Invoice 1000 已收清（balance=0）→ CN -200 apply | AR.balanceAmount=-200（T13） |
| J2 | **负 AR 不新增 CREDIT 状态** | balance=-200 后查 AR.status | 仍为既有枚举（OPEN/PARTIALLY_PAID 等），**无 AccountsReceivableStatus.CREDIT**（T14） |
| J3 | **负 AR 不参与 Aging** | balance=-200 读取投影 | effectiveAgingBucket=null（只对 balance>0 计算，T15） |
| J4 | **负 AR 禁止 Receipt Allocation** | balance=-200 → POST allocate | 409 RECEIPT_AR_NEGATIVE_BALANCE（T16） |
| J5 | **负 AR 禁止 WriteOff** | balance=-200 → write-off apply | 409 WRITE_OFF_AR_NEGATIVE_BALANCE（T17） |
| J6 | **DN 把负余额向 0 拉回** | AR=-200 → DN +200 apply | balance=0（DN 累计 200 ≤ ceiling，T18） |
| J7 | DN 拉回超过 0（正余额） | AR=-200 → DN +300 apply | balance=+100（DN 累计 300 ≤ ceiling 合法） |
| J8 | 负 AR 上再 CN | balance=-200 → CN -100 | 允许（更负；无数据库状态变化） |
| J9 | 负 AR 读取投影 | balance<0 读取 | isCreditBalance/creditAmount/effectiveBalanceType 投影（读取层） |
| J10 | 负 AR 的 AR Revision/Snapshot | CN 造成负余额 | Revision/Snapshot 记录 balanceAmount 负值（Decimal 字符串） |

## K. Projection Consistency（投影一致性——AR 事实源 / Invoice 余额投影）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| K1 | **Invoice.invoiceTotal 不变** | Apply 前后 | invoiceTotal 不变（T11——边界①） |
| K2 | **InvoiceLine 原始金额不变** | Apply 前后 | quantity/unitPrice/lineAmount/taxAmount/totalAmount 不变 |
| K3 | **InvoiceSnapshot 不变** | Apply 前后 | 无新 Snapshot、既有快照不变（4E-3 不生成 Invoice Snapshot） |
| K4 | Invoice.paidAmount 不变 | CN Apply | paidAmount 不变（CN ≠ Payment） |
| K5 | Invoice.writeOffAmount 不受影响 | Apply 前后 | 不涉及 writeOff（WriteOff 独立域） |
| K6 | **Invoice.balanceAmount = AR newBalance** | Apply 后 | 精确相等（computeBalance 单入口直写） |
| K7 | AR 四金额一致 | Apply 后 | balanceAmount == original + adjusted - paid - writeOff |
| K8 | 多 Note 后投影收敛 | CN×2 后 | AR.balanceAmount == Invoice.balanceAmount（投影恒等） |

## L. Concurrency（并发——锁序 InvoiceLine id ASC FOR UPDATE 防超调/防穿透）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| L1 | **两张 CN 并发 Apply 同一 InvoiceLine** | 原行 100、CN#1=60、CN#2=60 并发 apply | 至多一张成功；另一张 409 CN_DN_QUANTITY_EXCEEDED（第二事务等锁后重读累计，T8） |
| L2 | **两张 DEBIT 并发 Apply 同一行** | 原行金额 1000、DN#1=600、DN#2=600 并发 | 至多一张成功；另一张 409 CN_DN_AMOUNT_EXCEEDED |
| L3 | **同一 Note 两个请求同时 Apply** | 并发 apply 同一 note | 一张 201、另一张 409 CN_DN_ALREADY_APPLIED（锁内重读状态） |
| L4 | **CN Apply 与 Receipt Allocation 并发碰同一 AR** | CN apply ∥ receipt allocate 同一 AR | 无余额穿透、无死锁（两条资金事务都锁 AR，串行化后余额一致） |
| L5 | **CN Apply 与 WriteOff Apply 并发碰同一 AR** | CN apply ∥ write-off apply 同一 AR | 无余额穿透、无死锁（AR 锁串行化；WriteOff 负 AR 门禁在锁内生效） |
| L6 | 并发下 AR 状态投影一致 | 并发后读 AR | balanceAmount/status 与顺序执行一致 |
| L7 | 锁序稳定（InvoiceLine id ASC） | 多行 Note 并发 | 无死锁（稳定锁序） |
| L8 | 事件不阻塞事务 | 并发 apply | DB 事实已提交；事件失败降级不阻断 |

## M. Idempotency（幂等）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| M1 | **重复 Apply 409** | 同一 Note 二次 apply | 409 CN_DN_ALREADY_APPLIED（稳定幂等） |
| M2 | 重复 Submit 409 | 二次 submit | 409 CN_DN_INVALID_STATE |
| M3 | 并发重复 Apply | 两个请求同时 apply | 一个 201 一个 409（无重复 fact） |
| M4 | 重复创建不同 code | 两次 create | 两个不同 code（DocumentSequence 原子取号） |
| M5 | 同 Invoice 多次 CN 唯一 fact | 每行一次 Apply | 每次 apply 一行一条 fact（@@unique[sourceNoteId, invoiceId, invoiceLineId] 防重复） |
| M6 | 审计不重复 | 一次 apply | 一条 credit-debit-note.apply 审计 + 双事件 |

## N. Audit / Events（审计 / 事件）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| N1 | CreditDebitNoteCreated | 创建后 | AuditLog action=CreditDebitNoteCreated，payload 含 noteId/code/noteType/... |
| N2 | CreditDebitNoteSubmitted | submit 后 | action=CreditDebitNoteSubmitted |
| N3 | CreditDebitNoteApprovalStarted | 命中策略 submit | action=CreditDebitNoteApprovalStarted |
| N4 | CreditDebitNoteApproved | Workflow COMPLETED | action=CreditDebitNoteApproved（workflow actions 回写） |
| N5 | CreditDebitNoteRejected | Workflow REJECTED | action=CreditDebitNoteRejected |
| N6 | **InvoiceAdjustmentApplied** | Apply 后 | action=InvoiceAdjustmentApplied（事务外） |
| N7 | **AccountsReceivableAdjusted** | Apply 后 | action=AccountsReceivableAdjusted（entityType=accounts-receivable） |
| N8 | 事件失败降级 | 模拟事件发布失败 | DB 事实已提交，主流程不阻断（边界②） |
| N9 | 审计含 changeReason | create/submit/apply 带 changeReason | afterData 含 changeReason |
| N10 | 事件载荷基境字段 | 各事件 | 含 customerId/currency/amount 等基境字段（CI 教训） |
| N11 | **InvoiceAdjustmentReversed（Outbox）** | Reverse 后 | 事务内 OutboxMessage eventType=InvoiceAdjustmentReversed，幂等键 InvoiceAdjustmentReversed|noteId，载荷含 noteId/code/noteType/adjustmentTotal/reversedAt/reversedById |
| N12 | **GL 反向凭证** | Reverse 后 GL consumer 消费 | CREDIT 反冲 → 借1122贷6001；DEBIT 反冲 → 借6001贷1122（借贷平衡，sourceType=InvoiceAdjustmentReversed） |
| N13 | **GL consumer 白名单** | consumer.ts | InvoiceAdjustmentApplied + InvoiceAdjustmentReversed 均已注册（#163 漏注册修复） |

## O. Boundary / Error mapping（边界 / 错误映射）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| O1 | 错误码 CN_DN_NOT_FOUND | 不存在 Note | 404 CN_DN_NOT_FOUND |
| O2 | 错误码 CN_DN_INVALID_STATE | 状态不允许 | 409 CN_DN_INVALID_STATE |
| O3 | 错误码 CN_DN_ALREADY_APPLIED | 重复 Apply | 409 CN_DN_ALREADY_APPLIED |
| O4 | 错误码 CN_DN_APPROVAL_REQUIRED | 未审批 Apply | 409 CN_DN_APPROVAL_REQUIRED |
| O5 | 错误码 CN_DN_SOURCE_INVOICE_INVALID | 源发票无效 | 409 |
| O6 | 错误码 CN_DN_SOURCE_LINE_INVALID | 行无效 | 409 |
| O7 | 错误码 CN_DN_SOURCE_NOT_COMPATIBLE | customer/currency 不一致 | 409 |
| O8 | 错误码 CN_DN_QUANTITY_EXCEEDED | 数量超限 | 409 |
| O9 | 错误码 CN_DN_AMOUNT_EXCEEDED | 金额超限 | 409 |
| O10 | 错误码 CN_DN_WORKFLOW_FAILED | Workflow 配置异常 | 409 |
| O11 | Decimal 全程无 Float | 金额/余额/快照 | 全部 Prisma.Decimal + toString（无 toNumber） |
| O12 | 负余额 Decimal 字符串 | AR.balanceAmount 负值 | 快照/Revision 存 "-200.0000" 字符串 |
| O13 | 404 vs 409 语义 | 不存在=404；状态冲突=409 | 错误码映射正确 |
| O14 | 审计 entityType | 各事件 | credit-debit-note / accounts-receivable / invoice-adjustment 正确 |

## R. Reverse（反冲减——用户指令：贷/项也应支持反冲减）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| R1 | APPLIED 反冲成功 | POST /api/credit-debit-notes/:id/reverse（APPLIED） | 200；status=REVERSED；AR.adjustedAmount -= signedTotal；AR.balanceAmount=computeBalance 重算；Invoice.balanceAmount 同步 |
| R2 | 已 REVERSED 重复反冲 | 对 REVERSED 再 reverse | 409 CONFLICT（幂等稳定） |
| R3 | 未生效（DRAFT/SUBMITTED）反冲 | DRAFT/SUBMITTED reverse | 409 CN_DN_INVALID_STATE（仅 APPLIED 可反冲） |
| R4 | 不存在 | badId reverse | 404 NOT_FOUND |
| R5 | 关联 AR 不存在 | 反冲时 AR 已删 | 409 CN_DN_SOURCE_NOT_COMPATIBLE |
| R6 | InvoiceAdjustment 回写 | reverse 后 | 该单全部 adjustments.reversedAt/reversedById 非空 |
| R7 | AR Revision/Snapshot | reverse 后 | 新增 AR Revision（"CN/DN 反冲"）+ Snapshot(ADJUSTED/ADJUSTMENT) |
| R8 | 无权限 | 无 credit-debit-note:approve | 403 |
| R9 | 原 Invoice 金额事实不变 | reverse 后查 Invoice | invoiceTotal/subtotal/taxAmount 不变（仅 balanceAmount 回退） |
| R10 | 权限复用 | reverse 用 credit-debit-note:approve | 与 apply 同级权限 |

## S. Delete（删除——用户指令：贷/项也应支持删除）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| S1 | DRAFT 删除成功 | DELETE /api/credit-debit-notes/:id（DRAFT） | 200；header+lines+adjustments 软删（deletedAt/isActive=false） |
| S2 | CANCELLED 删除成功 | DELETE（CANCELLED） | 200 软删 |
| S3 | REVERSED 删除成功 | DELETE（REVERSED） | 200 软删（已反冲历史痕迹可清理） |
| S4 | APPLIED 禁止删除 | DELETE（APPLIED） | 409 CN_DN_INVALID_STATE（先反冲再删） |
| S5 | SUBMITTED 禁止删除 | DELETE（SUBMITTED） | 409 CN_DN_INVALID_STATE（先取消再删） |
| S6 | 不存在 | DELETE badId | 404 CN_DN_NOT_FOUND |
| S7 | 无权限 | 无 credit-debit-note:delete | 403 |
| S8 | 列表隔离 | 删除后 GET 列表 | 不再出现（deletedAt 过滤） |
| S9 | 审计 | 删除后 | AuditLog action=credit-debit-note.delete |

---

> 用例统计：A 12 + B 14 + C 18 + D 12 + E 12 + F 18 + G 8 + H 8 + I 8 + J 10 + K 8 + L 8 + M 6 + N 13 + O 14 + R 10 + S 9 = **190 用例**（覆盖用户 #5703 指定全部财务边界与 5 个并发场景；含 CN/DN 反冲减与删除状态机）
