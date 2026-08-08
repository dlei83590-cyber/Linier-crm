# Sprint 4E-2 QA — Receipt & Payment Allocation Foundation（收款/核销/坏账写销领域）

> Sprint：4E-2 | 模块：Receipt & Payment Allocation Foundation（Schema/Migration 0019 + Seed/RBAC + 收款/核销/冲销/作废/WriteOff 全链路 API） | PR：#17（feature/sprint4-sales，Open 待验收合并）
> 日期：2026-08-08
> 状态：✅ 代码门禁通过（CI 全绿：Receipt Create `d076e3a` / Allocation `c075dde`+`0440cd8` / Reversal-Void `68d697c`+`2353c8f` / WriteOff 三件套 `35bde4e`+`3b44ed0` / Create-Submit `4a89268`+`68fbe53` / Apply `224624d` / Workflow actions `aabedf2`）；**Ready for Final Review**（PR #17 合并后改 Completed）
> 关联：ADR-0021（Receipt & Payment Allocation Domain）、Sprint4E2_ReceiptAllocation_Design.md、EVENTS.md v1.10、openapi.yaml（Sprint 4E-2 段：+10 端点/+30 schemas，171 paths/453 schemas）
> 财务边界锁死（CTO 启动令 + Design Review 97/100 + 实施三阶段全部落地）：
> ① **Receipt 创建 ≠ Allocation**——POST /api/receipts 只记录实际收到的钱（UNALLOCATED，unallocatedAmount=amount），核销走显式 POST /api/receipts/{id}/allocate（一次请求原子化）；
> ② **Allocation 同 Customer / 同 Currency**——否则 409 RECEIPT_CUSTOMER_MISMATCH / RECEIPT_CURRENCY_MISMATCH（第一版禁止跨币种核销，FX 需单独设计汇兑损益）；
> ③ **Reversal ≠ Credit Note**——Allocation Reversal 解除核销关系并留痕（reversedAt/reversedBy/reverseReason 写入原记录，**不删除**）；CN 属 4E-3 发票调整域，不承担收款冲销（银行退票不是 CN）；
> ④ **WriteOff Approval ≠ Apply**——审批（Workflow）只回写投影，Apply 才是唯一修改 AR.writeOffAmount/balanceAmount 的入口；
> ⑤ **WriteOff 不增加 Invoice.paidAmount**——Apply 只减 Invoice.balanceAmount 投影，paidAmount 绝不因 write-off 增加（防止报表把坏账核销误判为客户实际付款）。

## 1. 交付范围

### 1.1 API（10 端点，均在 `apps/web/src/app/api/**`）
| 分组 | 端点 | 说明 |
| --- | --- | --- |
| 收款 | POST `/api/receipts` | 创建收款单（拍板①：只记录金额不核销；UNALLOCATED；拍板④：DocumentSequence 创建即取号 RCT-2026-xxxx） |
| 收款 | GET `/api/receipts` | 列表（分页 + customerId/status/currency 过滤；只读） |
| 收款 | GET `/api/receipts/{id}` | 详情（Receipt + Customer 摘要 + allocations 含 AR 摘要 + 最近 Revision/Snapshot） |
| 核销 | POST `/api/receipts/{id}/allocate` | 显式核销（一次请求原子化；M:N；事务红线见 §3） |
| 历史 | GET `/api/receipts/{id}/revisions` | 修订列表（只读，revisionNo desc） |
| 历史 | GET `/api/receipts/{id}/snapshots` | 快照列表（只读，generatedAt desc；CREATED/ALLOCATED/VOIDED/REVERSED） |
| 动作 | POST `/api/receipts/{id}/void` | 作废（仅 UNALLOCATED；已核销先 Reversal——409 RECEIPT_VOID_FORBIDDEN；无 CN 语义） |
| 冲销 | POST `/api/receipt-allocations/{id}/reverse` | Allocation Reversal（不删除原记录；恢复三方投影；重复冲销 409 RECEIPT_ALLOCATION_REVERSED） |
| 写销 | POST `/api/write-offs` | 创建 WriteOff（DRAFT + WriteOffAllocation；同 Customer/Currency 校验；**不修改 AR**；创建即取号 WO-2026-xxxx） |
| 写销 | GET `/api/write-offs` | 列表（分页 + status/customerId 过滤；含 allocations + AR 摘要） |
| 写销 | POST `/api/write-offs/{id}/submit` | DRAFT → SUBMITTED（命中 WRITE_OFF 策略 → Workflow 触发 PENDING；未命中 → 可直接 Apply） |
| 写销 | POST `/api/write-offs/{id}/apply` | **唯一回写 AR.writeOffAmount/balanceAmount 的入口**（状态门禁 + 防超核销 + 三方投影 + Snapshot(WRITE_OFF)） |

### 1.2 RBAC（权限码，动作级，零新造）
receipt:create（创建）/ receipt:edit（allocate、reverse）/ receipt:close（void）/ receipt:view + receipt-revision:view + receipt-snapshot:view
write-off:create（创建）/ write-off:edit（submit）/ write-off:approve（workflow 终态回写）/ write-off:view + write-off-allocation:view
（seed SEED_ACTION_MODULES 已注册 receipt / receipt-allocation / receipt-revision / receipt-snapshot / write-off / write-off-allocation）

### 1.3 Domain Events（EVENTS.md v1.10 注册 11 个，4E-2 全部实现）
ReceiptCreated ✅ / ReceiptUpdated（无 PATCH，预留）/ ReceiptAllocated ✅ / ReceiptFullyAllocated ✅ / ReceiptAllocationReversed ✅ / ReceiptVoided ✅
WriteOffCreated ✅ / WriteOffSubmitted ✅ / WriteOffApproved ✅（workflow actions 回写）/ WriteOffRejected ✅ / WriteOffApplied ✅
联动（v1.9 注册，Apply/Allocate 时发布）：AccountsReceivableWrittenOff ✅ / AccountsReceivablePartiallyPaid / Paid（Allocation 回写）

## 2. 测试要点（CTO 指令场景全覆盖）

| # | 场景 | 验证方式 | 实现位置 |
| --- | --- | --- | --- |
| T1 | Receipt 创建后 unallocatedAmount = amount | POST /api/receipts → status=UNALLOCATED、allocatedAmount=0、unallocatedAmount=amount、code=RCT-2026-xxxx | receipts/route.ts（拍板①④） |
| T2 | 一次 Receipt 核销多 AR | POST allocate {allocations:[AR1,AR2]} → 两条 ReceiptAllocation、AR 各自 paidAmount+=、Receipt 投影 Σ | [id]/allocate/route.ts（M:N） |
| T3 | 同一 AR 被多个 Receipt 部分核销 | 两张 Receipt 分别 allocate 同一 AR 部分金额 → AR.paidAmount 累加、balanceAmount 递减、Receipt 各自 PARTIALLY_ALLOCATED | 多 Receipt 顺序核销 |
| T4 | 防超核销 409 | allocate 金额 > AR.balanceAmount → 409 RECEIPT_ALLOCATION_EXCEEDED（锁内读） | allocate 事务红线⑤ |
| T5 | Customer 不一致 409 | Receipt.customerId ≠ AR.customerId → 409 RECEIPT_CUSTOMER_MISMATCH | allocate 事务红线③ |
| T6 | Currency 不一致 409 | Receipt.currency ≠ AR.currency → 409 RECEIPT_CURRENCY_MISMATCH | allocate 事务红线③ |
| T7 | 并发 Allocation 不超余额 | 两请求并发 allocate 同一 AR 剩余余额 → 锁（id ASC FOR UPDATE）串行化，第二个 409 ALLOCATION_EXCEEDED | 锁序 + 锁内校验 |
| T8 | Reversal 精确恢复三方投影 | reverse 后：AR.paidAmount 回退 / balanceAmount 重算 / Invoice.paidAmount-balanceAmount 回退 / Receipt allocatedAmount-unallocatedAmount 恢复 | [id]/reverse/route.ts |
| T9 | 已核销 Receipt 不可直接 VOID | allocate 后 void → 409 RECEIPT_VOID_FORBIDDEN（须先 Reversal） | [id]/void/route.ts 状态门禁 |
| T10 | 未核销 Receipt 可 VOID | UNALLOCATED → void → 200/201 status=VOIDED + voidedAt/voidedById + Snapshot(VOIDED) | [id]/void/route.ts |
| T11 | WriteOff 命中审批策略 → PENDING | submit 命中 WRITE_OFF 策略 → approvalStatus=PENDING + workflowInstanceId + 事件 WriteOffSubmitted/ApprovalStarted | submit + workflow-sync |
| T12 | WriteOff 未审批禁止 Apply | 命中策略但未 APPROVED → apply → 409 WRITE_OFF_APPROVAL_REQUIRED | apply 状态门禁 |
| T13 | APPROVED 仍未影响 AR | workflow COMPLETED → approvalStatus=APPROVED；AR.writeOffAmount/balanceAmount **不变**（审批≠生效） | actions 路由 + apply 门禁 |
| T14 | Apply 后 AR.writeOffAmount 增加 | apply → AR.writeOffAmount += allocation、balanceAmount 重算（computeBalance 单入口） | apply 事务 |
| T15 | Invoice.balanceAmount 下降 | apply → Invoice.balanceAmount 投影同步减少 | apply 事务 |
| T16 | Invoice.paidAmount 保持不变 | apply 前后 Invoice.paidAmount 不变（WriteOff ≠ Payment——CTO 锁死） | apply 事务（不写 paidAmount） |
| T17 | 重复 Apply 返回 409 | 二次 apply → 409 WRITE_OFF_ALREADY_APPLIED（幂等/稳定 409） | apply 状态门禁 |
| T18 | AR Snapshot source = WRITE_OFF | apply 后 GET /api/accounts-receivables/{id}/snapshots → snapshotSource=WRITE_OFF、snapshotType=WRITTEN_OFF | apply 事务 + AR snapshot |

## 3. Allocation 事务红线（CTO 指定顺序，Final Review 按此检查）

```
Lock Receipt（FOR UPDATE）
 ↓
Lock all target AR rows（按 id ASC，FOR UPDATE——对齐 4C 防超交 / 4D 防超开票锁序）
 ↓
Validate customer/currency（Receipt.customerId == AR.customerId；currency 一致，否则 409）
 ↓
Validate Receipt unallocated balance（Σ allocations ≤ unallocatedAmount，否则 409 RECEIPT_UNALLOCATED_EXCEEDED）
 ↓
Validate each allocation ≤ AR.balanceAmount（锁内读，否则 409 RECEIPT_ALLOCATION_EXCEEDED——并发双核销不超余额）
 ↓
Create ReceiptAllocation（同一 (receipt, AR) 只核销一次）
 ↓
Update AR paidAmount / balanceAmount（computeBalance 单入口）+ status 投影（OPEN→PARTIALLY_PAID→PAID）
 ↓
Update Invoice paidAmount / balanceAmount projection
 ↓
Update Receipt allocatedAmount / unallocatedAmount / status 投影（→PARTIALLY/FULLY_ALLOCATED）
 ↓
AR Revision + Snapshot（snapshotSource=PAYMENT）+ Receipt Revision/Snapshot（ALLOCATED）
 ↓
Domain Events（ReceiptAllocated / ReceiptFullyAllocated，事务外）
```

## 4. WriteOff Apply 事务红线（Final Review 检查点）

```
Lock WriteOff（FOR UPDATE）
 ↓
Lock all target AR rows（按 id ASC，FOR UPDATE）
 ↓
状态门禁：APPLIED → 409 WRITE_OFF_ALREADY_APPLIED；非 SUBMITTED → 409 WRITE_OFF_INVALID_STATE；
        命中审批但未 APPROVED → 409 WRITE_OFF_APPROVAL_REQUIRED；无策略 → 可直接 Apply
 ↓
每笔 allocationAmount ≤ AR.balanceAmount（否则 409 WRITE_OFF_AMOUNT_EXCEEDED）
 ↓
同事务：
  AR.writeOffAmount += allocation
  AR.balanceAmount 重算（computeBalance 单入口）
  AR.status 投影
  Invoice.balanceAmount 投影同步减少（**paidAmount 绝不增加——WriteOff ≠ Payment**）
  AR Revision + Snapshot（snapshotSource=WRITE_OFF）
  WriteOff status=APPLIED + appliedAt/appliedById
 ↓
事件 WriteOffApplied + AccountsReceivableWrittenOff（事务外；事件失败可降级，但 DB 事实更新不静默失败）
```

## 5. 手工验收清单（Final Review 前置）

- [ ] 创建：POST /api/receipts 成功后 code=RCT-2026-xxxx、status=UNALLOCATED、unallocatedAmount=amount、Revision/Snapshot(CREATED) 生成
- [ ] 列表：GET /api/receipts 分页 + customerId/status/currency 过滤 + customer 摘要 + allocations 计数
- [ ] 详情：GET /api/receipts/{id} 一次带出 allocations（含 AR 摘要）+ 最近 revision/snapshot
- [ ] 核销：单 AR / 多 AR / 部分核销 / 全额核销（FULLY_ALLOCATED）/ 超未分配 409 / 超余额 409
- [ ] 一致性：跨客户 409 / 跨币种 409 / 已作废核销 409
- [ ] 并发：同一 AR 并发 allocate → 锁串行化，第二个 409 不超余额
- [ ] 冲销：reverse 后三方投影精确恢复；原 Allocation 不删除（reversedAt 留痕）；重复冲销 409
- [ ] 作废：未核销可 void（VOIDED + 快照）；已核销 void → 409 RECEIPT_VOID_FORBIDDEN
- [ ] WriteOff：创建（同 Customer/Currency 校验 409、amount>0、Σ 计算、不修改 AR）；列表过滤
- [ ] WriteOff submit：命中策略 → PENDING + workflowInstanceId；未命中 → 可直接 Apply；非 DRAFT → 409
- [ ] WriteOff apply：APPROVED 门禁 / 重复 Apply 409 / AR.writeOffAmount↑ / balanceAmount↓ / Invoice.balanceAmount↓
- [ ] **WriteOff 不增加 Invoice.paidAmount**（apply 前后 paidAmount 不变——财务红线）
- [ ] AR Snapshot snapshotSource=WRITE_OFF；AR Revision 留痕
- [ ] Workflow actions：businessType="write-off" COMPLETED→APPROVED / REJECTED→REJECTED
- [ ] 权限：receipt* / write-off* 无权限 403；revision/snapshot 各自权限码
- [ ] 事件：ReceiptCreated/Allocated/FullyAllocated/AllocationReversed/Voided + WriteOffCreated/Submitted/Approved/Rejected/Applied 均以 AuditLog 留痕
- [ ] Decimal 全程（18,4）；快照金额 toString 禁止 toNumber

## 6. 红线核验（Final Review checklist 前置）

- [x] 无 Payment 独立表（Receipt 唯一收款事实源）
- [x] 无 ReceiptApproval / WriteOffApproval 表（Workflow 唯一审批事实源）
- [x] 无 Credit Note / Debit Note（4E-3 发票调整域，本阶段不进入）
- [x] 无 PATCH Receipt / AR 金额（受控投影，事务驱动）
- [x] Receipt 创建与核销分离（拍板①）
- [x] 同 Customer + 同 Currency 才允许 Allocation（409，禁跨币种）
- [x] AR 锁序 id ASC FOR UPDATE（防死锁 + 防超核销）
- [x] Allocation Reversal 不删除原记录（reversedAt/reversedBy/reverseReason 留痕）
- [x] Reversal ≠ Credit Note（CN 属 4E-3，不承担收款冲销）
- [x] VOID 仅未核销；已核销先 Reversal（409 RECEIPT_VOID_FORBIDDEN）
- [x] WriteOff 独立事实（不做三件套；审批历史 Workflow、审计 AuditLog）
- [x] APPROVED ≠ APPLIED（Apply 唯一修改 AR.writeOffAmount/balanceAmount 的入口）
- [x] WriteOff 不增加 Invoice.paidAmount（只减 balanceAmount 投影）
- [x] 重复 Apply 稳定 409 WRITE_OFF_ALREADY_APPLIED
- [x] AR / Invoice / Receipt 三方投影一致（computeBalance 单入口）
- [x] Decimal 全程（18,4）无 Float；快照金额 toString
