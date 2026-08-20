# Receipt / WriteOff API 测试用例（Sprint 4E-2 Receipt & Payment Allocation Foundation）

> 模块：Receipt & Payment Allocation Foundation（收款/核销/冲销/作废/坏账写销）
> 关联：docs/qa/Sprint4E2_QA.md、ADR-0021、Sprint4E2_ReceiptAllocation_Design.md、API_GUIDELINES.md、ERROR_CODES.md、EVENTS.md v1.10
> 说明：覆盖 10 端点；重点覆盖 CTO 财务边界锁死：**Receipt 创建 ≠ Allocation**（创建与核销分离）、**Allocation 同 Customer/同 Currency**（禁跨币种）、
> **Reversal ≠ Credit Note**（冲销留痕不删除，CN 属 4E-3）、**WriteOff APPROVED ≠ APPLIED**（Apply 唯一改 AR 金额入口）、
> **WriteOff 不增加 Invoice.paidAmount**（只减 balanceAmount 投影）；以及 Concurrency（锁序 id ASC FOR UPDATE 防超核销）、
> Reversal（三方投影精确恢复）、Projection consistency（AR/Invoice/Receipt）、Workflow（WRITE_OFF 条件审批）、Boundary（Decimal 全程、快照 toString）。

## A. 认证与权限（Permission）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 | POST /api/receipts | 401 AUTHENTICATION_ERROR |
| A2 | 无 receipt:create | POST /api/receipts | 403 FORBIDDEN |
| A3 | 无 receipt:view | GET /api/receipts | 403 |
| A4 | 无 receipt:view | GET /api/receipts/:id | 403 |
| A5 | 无 receipt:edit | POST /api/receipts/:id/allocate | 403 |
| A6 | 无 receipt:edit | POST /api/receipt-allocations/:id/reverse | 403 |
| A7 | 无 receipt:close | POST /api/receipts/:id/void | 403 |
| A8 | 无 receipt-revision:view | GET /api/receipts/:id/revisions | 403 |
| A9 | 无 receipt-snapshot:view | GET /api/receipts/:id/snapshots | 403 |
| A10 | 无 write-off:create | POST /api/write-offs | 403 |
| A11 | 无 write-off:view | GET /api/write-offs | 403 |
| A12 | 无 write-off:edit | POST /api/write-offs/:id/submit | 403 |
| A13 | 无 write-off:approve | POST /api/write-offs/:id/apply（命中审批场景） | 403 |
| A14 | 权限码覆盖 6 模块 | receipt* / receipt-allocation* / receipt-revision* / receipt-snapshot* / write-off* / write-off-allocation* | 无权限 403 |

## B. 端点存在性 / 边界（Endpoint / Boundary）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | Receipt 无 PATCH | PATCH /api/receipts/:id | 404/405（金额/状态受控投影——拍板②，禁止 PATCH） |
| B2 | Receipt 无 DELETE | DELETE /api/receipts/:id | 404/405（财务事实，禁止删除） |
| B3 | Allocation 无 DELETE | DELETE /api/receipt-allocations/:id | 404/405（冲销走 reverse 留痕，不删除） |
| B4 | WriteOff 无 PATCH | PATCH /api/write-offs/:id | 404/405（独立事实，submit/apply 事务驱动） |
| B5 | WriteOff 无 DELETE | DELETE /api/write-offs/:id | 404/405（财务历史，禁止删除） |
| B6 | 列表空数据 | GET /api/receipts（无数据） | 200 空数组 + meta |
| B7 | 分页边界 | GET /api/receipts?pageSize=500 | 钳制 100 |
| B8 | 分页默认 | GET /api/receipts（无参数） | page=1 pageSize=20 |
| B9 | 详情不存在 | GET /api/receipts/:badId | 404 RECEIPT_NOT_FOUND |
| B10 | 核销目标不存在 | POST /api/receipts/:id/allocate（AR 不存在） | 404 ACCOUNTS_RECEIVABLE_NOT_FOUND |
| B11 | 冲销记录不存在 | POST /api/receipt-allocations/:badId/reverse | 404 RECEIPT_ALLOCATION_NOT_FOUND |
| B12 | WriteOff 不存在 | POST /api/write-offs/:badId/submit | 404 WRITE_OFF_NOT_FOUND |
| B13 | WriteOff 不存在 | POST /api/write-offs/:badId/apply | 404 WRITE_OFF_NOT_FOUND |
| B14 | 软删除隔离 | deletedAt 记录 | 不出现在列表/详情 |

## C. Receipt 创建（Create）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| C1 | 创建成功 | POST /api/receipts | 201；code=RCT-2026-xxxx；status=UNALLOCATED；allocatedAmount=0；**unallocatedAmount=amount**（T1） |
| C2 | 编号创建即取号 | POST /api/receipts ×2 | 两个不同 code，递增（拍板④） |
| C3 | 默认币种 | POST（无 currency） | currency=CNY |
| C4 | 指定币种 | POST（currency=USD） | currency=USD |
| C5 | amount 必填 | POST（无 amount） | 400 VALIDATION_ERROR |
| C6 | amount=0 | POST（amount=0） | 400（positive 校验） |
| C7 | amount 负数 | POST（amount=-100） | 400 |
| C8 | paymentMethod 必填 | POST（无 paymentMethod） | 400 |
| C9 | paymentMethod 非法 | POST（paymentMethod=CRYPTO） | 400（枚举校验） |
| C10 | customerId 必填 | POST（无 customerId） | 400 |
| C11 | currency 长度 | POST（currency=CN） | 400（min 3） |
| C12 | referenceNo 可空 | POST（referenceNo=null） | 201，referenceNo=null |
| C13 | receiptDate 可选 | POST（无 receiptDate） | 201，receiptDate=now |
| C14 | 创建生成 Revision | POST 成功 | ReceiptRevision 生成（revisionNo=1，changeReason=创建收款单） |
| C15 | 创建生成 Snapshot | POST 成功 | ReceiptSnapshot(snapshotType=CREATED) 生成，金额 toString |
| C16 | 创建发布事件 | POST 成功 | AuditLog 记 ReceiptCreated（receiptId/receiptCode/customerId/currency/amount） |
| C17 | 创建不核销 | POST 成功 | 无 ReceiptAllocation 生成（创建 ≠ 核销——拍板①） |

## D. Receipt 查询（List / Detail / Revisions / Snapshots）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| D1 | 列表分页 | GET /api/receipts?page&pageSize | 200 分页 meta |
| D2 | customerId 过滤 | GET ?customerId=xxx | 只返回该客户收款 |
| D3 | status 过滤 | GET ?status=UNALLOCATED | 只返回未核销 |
| D4 | status=FULLY_ALLOCATED 过滤 | GET ?status=FULLY_ALLOCATED | 只返回全核销 |
| D5 | currency 过滤 | GET ?currency=CNY | 只返回 CNY |
| D6 | 组合过滤 | GET ?customerId&status&currency | 多条件 AND |
| D7 | 列表含 customer 摘要 | GET | 每项含 customer{id,code,name} |
| D8 | 列表含 allocations 计数 | GET | 每项含 _count.allocations |
| D9 | 详情一次带出 | GET /api/receipts/:id | Receipt + customer + allocations（含 AR 摘要）+ 最近 revision/snapshot |
| D10 | 详情 allocations 含 AR | GET /api/receipts/:id | allocation.accountsReceivable{id,invoiceId,balanceAmount,status} |
| D11 | 详情 allocations 倒序 | GET /api/receipts/:id | allocations 按 allocatedAt desc |
| D12 | revisions 只读列表 | GET /api/receipts/:id/revisions | revisionNo desc |
| D13 | snapshots 只读列表 | GET /api/receipts/:id/snapshots | generatedAt desc；含 snapshotType |
| D14 | 子资源不存在 | GET /api/receipts/:badId/revisions | 404 RECEIPT_NOT_FOUND |

## E. Allocation 核销（正常路径）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| E1 | 单 AR 全额核销 | POST /api/receipts/:id/allocate | 200；AR balanceAmount=0 → status=PAID；Receipt FULLY_ALLOCATED（T2 部分） |
| E2 | 单 AR 部分核销 | allocate 金额 < AR.balanceAmount | AR PARTIALLY_PAID；Receipt PARTIALLY_ALLOCATED |
| E3 | 一次核销多 AR（M:N） | allocations:[AR1,AR2] | 两条 ReceiptAllocation；AR 各自回写（T2） |
| E4 | 同一 AR 被多个 Receipt 部分核销 | Receipt1 核 30% + Receipt2 核 70% | AR.paidAmount 累加、balanceAmount 递减至 0 → PAID（T3） |
| E5 | 同一 (receipt, AR) 去重 | allocations 重复 AR | 金额聚合为一行（Map 合并） |
| E6 | 核销后 AR paidAmount 增加 | allocate | AR.paidAmount += allocatedAmount |
| E7 | 核销后 AR balanceAmount 重算 | allocate | computeBalance 单入口，= original+adjusted-paid-writeOff |
| E8 | 核销后 AR lastPaymentAt 更新 | allocate | lastPaymentAt=now |
| E9 | Invoice 投影回写 | allocate | Invoice.paidAmount += ；balanceAmount=invoiceTotal-paidAmount |
| E10 | Receipt 投影回写 | allocate | allocatedAmount+=Σ；unallocatedAmount-=Σ；status 投影 |
| E11 | AR Revision 生成 | allocate | createAccountsReceivableRevision（changeReason=核销收款） |
| E12 | AR Snapshot(PAYMENT) 生成 | allocate | snapshotSource=PAYMENT；snapshotType=PARTIALLY_PAID/PAID |
| E13 | Receipt Snapshot(ALLOCATED) 生成 | allocate | snapshotType=ALLOCATED |
| E14 | 核销发布事件 | allocate | AuditLog 记 ReceiptAllocated（或 ReceiptFullyAllocated 当 unallocated=0） |
| E15 | 全额核销事件类型 | allocate 至 unallocated=0 | ReceiptFullyAllocated |

## F. Allocation 校验 / 409（一致性 + 防超核销）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| F1 | Customer 不一致 | Receipt.customerA + AR.customerB | 409 RECEIPT_CUSTOMER_MISMATCH（T5） |
| F2 | Currency 不一致 | Receipt.CNY + AR.USD | 409 RECEIPT_CURRENCY_MISMATCH（T6） |
| F3 | 多 AR 中一个不一致 | allocations:[AR1 同客户, AR2 跨客户] | 409 CUSTOMER_MISMATCH，整体回滚（原子化） |
| F4 | 超未分配余额 | Σ allocations > receipt.unallocatedAmount | 409 RECEIPT_UNALLOCATED_EXCEEDED |
| F5 | 超应收余额 | allocation > AR.balanceAmount | 409 RECEIPT_ALLOCATION_EXCEEDED（T4） |
| F6 | 已作废收款不可核销 | void 后 allocate | 409 RECEIPT_VOID_FORBIDDEN |
| F7 | 核销空数组 | allocations=[] | 400（min 1） |
| F8 | 核销金额 0 | allocation amount=0 | 400（positive） |
| F9 | 核销金额负数 | allocation amount=-10 | 400 |
| F10 | 部分失败整体回滚 | 多 AR 中一个超余额 | 全部回滚：无 ReceiptAllocation、AR 无变化、Receipt 无变化 |

## G. 并发（Concurrency）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| G1 | 并发核销同一 AR（防超核销） | 两请求各 allocate 60%（余额 100） | 锁（id ASC FOR UPDATE）串行化：第一个成功，第二个 409 RECEIPT_ALLOCATION_EXCEEDED（T7） |
| G2 | 并发核销同一 Receipt | 两请求分配同一 Receipt 剩余额度 | 第二个 409 RECEIPT_UNALLOCATED_EXCEEDED |
| G3 | 并发冲销同一 Allocation | 两请求 reverse 同 id | 第二个 409 RECEIPT_ALLOCATION_REVERSED |
| G4 | 并发 void + allocate | void 与 allocate 竞争同一 Receipt | 锁串行化，后到者 409（VOID_FORBIDDEN / 已作废） |
| G5 | 并发 apply 同一 WriteOff | 两请求 apply 同 id | 第二个 409 WRITE_OFF_ALREADY_APPLIED（锁内重读状态） |
| G6 | 锁序防死锁 | 多 AR 并发核销（AR 顺序相反） | 均按 id ASC 锁序，无死锁 |
| G7 | 并发不同 AR 互不阻塞 | AR1/AR2 各自核销 | 均可成功（行级锁隔离） |

## H. Reversal 冲销（Allocation Reversal）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| H1 | 冲销成功 | POST /api/receipt-allocations/:id/reverse | 200；reversedAmount 返回 |
| H2 | 原 Allocation 不删除 | reverse 后 | ReceiptAllocation 仍存在，reversedAt/reversedBy/reverseReason 写入（留痕——CTO 锁定） |
| H3 | AR.paidAmount 回退 | reverse | AR.paidAmount -= reversedAmount |
| H4 | AR.balanceAmount 重算 | reverse | computeBalance 单入口恢复 |
| H5 | AR.status 投影回退 | reverse 后 balance>0 | PARTIALLY_PAID（或 OPEN 当 paid=0） |
| H6 | AR.lastPaymentAt 回退 | reverse | lastPaymentAt=null |
| H7 | Invoice 投影回退 | reverse | Invoice.paidAmount -= ；balanceAmount 恢复 |
| H8 | Receipt 投影恢复 | reverse | allocatedAmount-=；unallocatedAmount+=；status → UNALLOCATED（全部冲销时） |
| H9 | 部分冲销状态 | 一张 Receipt 多 AR，冲销其一 | Receipt status=PARTIALLY_ALLOCATED |
| H10 | AR Revision 留痕 | reverse | 新 Revision（changeReason=冲销核销：原因） |
| H11 | Receipt Snapshot(REVERSED) | reverse | snapshotType=REVERSED |
| H12 | 重复冲销 | 二次 reverse 同 id | 409 RECEIPT_ALLOCATION_REVERSED（T8 补充） |
| H13 | 冲销发布事件 | reverse | AuditLog 记 ReceiptAllocationReversed |
| H14 | 冲销≠Credit Note | 银行退票场景 | 无 CN 语义、无发票金额调整（边界——T8） |
| H15 | 三方投影精确恢复 | 全额核销→全额冲销 | AR/Invoice/Receipt 投影全部回到核销前（T8 核心） |

## I. Void 作废

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| I1 | 未核销可 VOID | POST /api/receipts/:id/void（UNALLOCATED） | 201；status=VOIDED；voidedAt/voidedById 写入（T10） |
| I2 | 已核销不可直接 VOID | allocate 后 void | 409 RECEIPT_VOID_FORBIDDEN（T9） |
| I3 | 已作废重复 VOID | 二次 void | 409 RECEIPT_VOID_FORBIDDEN（已作废） |
| I4 | VOID 生成 Snapshot | void | ReceiptSnapshot(snapshotType=VOIDED) |
| I5 | VOID 生成 Revision | void | 新 Revision（changeReason=作废收款单） |
| I6 | VOID 发布事件 | void | AuditLog 记 ReceiptVoided |
| I7 | VOID 无 CN 语义 | void | 不产生 Credit Note、不影响发票金额（边界） |
| I8 | 已核销先 Reversal 再处理 | reverse 全部后 void | 可成功 VOID（拍板② 路径） |

## J. WriteOff 创建（Create）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| J1 | 创建成功 | POST /api/write-offs | 201；status=DRAFT；code=WO-2026-xxxx；amount=Σ allocations |
| J2 | 编号创建即取号 | POST ×2 | code 递增（拍板④） |
| J3 | 不修改 AR | 创建后 | AR.writeOffAmount/balanceAmount **不变**（暂不修改——红线） |
| J4 | 同 Customer 校验 | 目标 AR 跨客户 | 409 WRITE_OFF_SOURCE_NOT_COMPATIBLE |
| J5 | 同 Currency 校验 | 目标 AR 跨币种 | 409 WRITE_OFF_SOURCE_NOT_COMPATIBLE |
| J6 | 多 AR 同客户同币种 | allocations:[AR1,AR2] 同客户同币种 | 201；两条 WriteOffAllocation |
| J7 | AR 不存在 | allocations 含无效 AR | 404 ACCOUNTS_RECEIVABLE_NOT_FOUND |
| J8 | amount=0 | allocation amount=0 | 400 WRITE_OFF_AMOUNT_EXCEEDED（validateWriteOffAmount） |
| J9 | amount 负数 | allocation amount=-5 | 400 WRITE_OFF_AMOUNT_EXCEEDED |
| J10 | amount=Σ 服务端计算 | 传 allocations | 头 amount 服务端 computeWriteOffTotal，禁止直传 |
| J11 | reason 必填 | 无 reason | 400 VALIDATION_ERROR |
| J12 | WriteOffAllocation 明细 | 创建成功 | allocations 每行 {writeOffId, accountsReceivableId, amount} |
| J13 | 发布事件 | 创建成功 | AuditLog 记 WriteOffCreated（writeOffId/code/customerId/currency/amount/arIds/reason） |
| J14 | 列表过滤 | GET /api/write-offs?status=DRAFT&customerId | 过滤正确 |
| J15 | 列表含 AR 摘要 | GET /api/write-offs | allocations.accountsReceivable{id,invoiceId,balanceAmount,customerId,currency} |

## K. WriteOff Submit + Workflow

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| K1 | DRAFT → SUBMITTED | POST /api/write-offs/:id/submit | 200；status=SUBMITTED |
| K2 | 非 DRAFT 不可提交 | APPLIED 后 submit | 409 WRITE_OFF_INVALID_STATE |
| K3 | 命中策略 → PENDING | submit（WRITE_OFF 策略命中金额区间） | approvalStatus=PENDING + workflowInstanceId + workflowTriggered=true（T11） |
| K4 | 未命中策略 → 可直接 Apply | submit（无策略/无规则匹配） | workflowSkipped=no-policy/no-rule-matched；approvalStatus 仍 DRAFT（T11 补充） |
| K5 | 已有 RUNNING 实例不重复建 | 二次 submit | 保持 PENDING，skipped=instance-running |
| K6 | 不修改 AR | submit | AR.writeOffAmount/balanceAmount 不变（审批≠生效） |
| K7 | 发布事件 | submit | AuditLog 记 WriteOffSubmitted |
| K8 | Workflow COMPLETED → APPROVED | workflow actions（businessType=write-off） | syncWriteOffApproval：approvalStatus=APPROVED + approvedAt/approvedById（T12 前置） |
| K9 | Workflow REJECTED → REJECTED | workflow actions | approvalStatus=REJECTED |
| K10 | APPROVED 仍未影响 AR | APPROVED 后检查 | AR.writeOffAmount/balanceAmount **不变**（T13——APPROVED ≠ APPLIED） |

## L. WriteOff Apply（财务生效入口）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| L1 | 无策略直接 Apply 成功 | SUBMITTED + 未命中策略 → apply | 201；status=APPLIED；appliedAt/appliedById（T14 前置） |
| L2 | 命中审批未 APPROVED 禁止 | PENDING → apply | 409 WRITE_OFF_APPROVAL_REQUIRED（T12） |
| L3 | APPROVED 后 Apply 成功 | APPROVED → apply | 201；status=APPLIED（T14 前置） |
| L4 | 重复 Apply | 二次 apply | 409 WRITE_OFF_ALREADY_APPLIED（T17——幂等稳定 409） |
| L5 | 非 SUBMITTED 状态 Apply | DRAFT → apply | 409 WRITE_OFF_INVALID_STATE |
| L6 | AR.writeOffAmount 增加 | apply | AR.writeOffAmount += allocation（T14） |
| L7 | AR.balanceAmount 重算 | apply | computeBalance：original+adjusted-paid-writeOff（T14） |
| L8 | AR.status 投影 | apply 后 balance=0 | PAID/CLOSED 投影（余额=0 且生命周期结束） |
| L9 | **Invoice.paidAmount 不变** | apply 前后 | **paidAmount 保持原值——WriteOff ≠ Payment（T16，财务红线）** |
| L10 | Invoice.balanceAmount 下降 | apply | balanceAmount 投影同步减少（T15） |
| L11 | 超余额 Apply | allocation > AR.balanceAmount | 409 WRITE_OFF_AMOUNT_EXCEEDED |
| L12 | AR Revision 生成 | apply | createAccountsReceivableRevision（changeReason 含写销） |
| L13 | **AR Snapshot(WRITE_OFF)** | apply 后 GET snapshots | snapshotSource=WRITE_OFF、snapshotType=WRITTEN_OFF（T18） |
| L14 | WriteOff 事件 | apply | AuditLog 记 WriteOffApplied + AccountsReceivableWrittenOff |
| L15 | 事件失败降级不阻断 | 事件发布异常 | DB 事实已提交；主流程不失败（CTO：DB 更新不静默失败） |
| L16 | 多 AR Apply | allocations:[AR1,AR2] | 全部 AR 回写；totalApplied=Σ |
| L17 | 锁 WriteOff + AR(id ASC) | apply 事务 | FOR UPDATE 锁；防并发重复生效 |
| L18 | 响应结构 | apply | {writeOffId, status:APPLIED, appliedAt, arIds, totalApplied} |

## M. 投影一致性（Projection Consistency）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| M1 | AR 恒等式 | 任意动作后 | balanceAmount = original + adjusted - paid - writeOff（computeBalance 单入口） |
| M2 | Receipt 恒等式 | 任意动作后 | amount = allocatedAmount + unallocatedAmount |
| M3 | Invoice 投影一致 | allocate/reverse 后 | Invoice.balanceAmount = invoiceTotal - paidAmount |
| M4 | AR/Invoice paidAmount 同步 | allocate/reverse | AR.paidAmount 与 Invoice.paidAmount 同步增减 |
| M5 | WriteOff 与 Payment 隔离 | apply 后 | AR.paidAmount 不变、Invoice.paidAmount 不变（坏账 ≠ 收款） |
| M6 | 全额核销后 AR PAID | allocate 至余额 0 | AR.status=PAID |
| M7 | 全额冲销后 AR OPEN | reverse 至 paid=0 | AR.status=OPEN |
| M8 | 快照金额 toString | 全部快照 | 金额 Decimal 字符串，禁止 toNumber |
| M9 | 金额 Decimal(18,4) | 全链路 | 无 Float 精度问题（0.1+0.2 场景） |

## N. 边界 / Decimal / 错误码（Boundary）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| N1 | 金额精度 | amount=99999999.9999 | Decimal(18,4) 精确存储 |
| N2 | 大额核销 | 多 AR 累计大额 | 无溢出；Σ 精确 |
| N3 | 未认证全部端点 | 10 端点逐一 | 401 |
| N4 | 错误码注册 | errors.ts | RECEIPT_* 9 个 + WRITE_OFF_* 8 个与 ERROR_CODES.md 一致 |
| N5 | 错误码唯一 | 全仓库 | 无魔法字符串散落（统一 ERROR_CODES） |
| N6 | 软删除隔离（WriteOff） | deletedAt 记录 | 不出现在列表/详情 |
| N7 | 分页钳制（WriteOff） | ?pageSize=500 | 钳制 100 |
| N8 | 空列表（WriteOff） | 无数据 | 200 空数组 |
| N9 | Invoice 删除保护 | AR 存在时删 Invoice | Restrict 阻止（4E-1 必改③ 延续） |
| N10 | 事件载荷基境字段 | 全部 4E-2 事件 | 载荷含 customerId/currency/amount（CI 教训：缺字段致 Quality Gates 红） |

## O. 销售侧 GL（ADR-0042，2026-08-20）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| O1 | ReceiptAllocated Outbox 原子写 | allocate 事务（逐核销行） | 每 ReceiptAllocation 行同事务写 Outbox（幂等键 ReceiptAllocated|receiptAllocationId），载荷含 paymentMethod |
| O2 | 收款入账凭证 | GL consumer 消费 ReceiptAllocated | 借 1002 银行（CASH→1001）/ 贷 1122 应收（allocatedAmount）；借贷平衡 |
| O3 | 核销反转红字 | GL consumer 消费 ReceiptAllocationReversed | 借 1122 / 贷 1002（反向）；sourceType=ReceiptAllocationReversed |
| O4 | 反转幂等 | 重复反转 | 409 ALREADY_REVERSED（路由守卫）；GL 侧 @@unique 幂等 |
| O5 | VOID 无 GL | 未核销收款单 VOID | 无 GL 凭证（仅 UNALLOCATED 可 VOID，无入账事实） |
