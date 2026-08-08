# Sprint 4E-3 QA — Credit Note / Debit Note（发票调整与应收调整领域）

> Sprint：4E-3 | 模块：Credit Note / Debit Note Foundation（Schema/Migration 0020 + Seed/RBAC + Create/Submit/Apply/Workflow 全链路 API） | PR：#18（feature/sprint4-sales，Open 待验收合并）
> 日期：2026-08-08
> 状态：✅ 代码门禁通过（CI 全绿：Schema `07d98a3` / Migration 0020 `f84c887` / Seed-RBAC `4af95c0`+`196068c` / Create `3d0e75b` / Submit `70f4daf` / Apply `b49629c` / Workflow Actions `21098ce` / OpenAPI `23fa11e`）；**Ready for Final Review**（PR #18 合并后改 Completed）
> 关联：ADR-0022（Credit Note / Debit Note Domain）、Sprint4E3_CreditDebitNote_Design.md、EVENTS.md v1.12、openapi.yaml（Sprint 4E-3 段：+4 端点/+13 schemas，174 paths/466 schemas）
> 财务边界锁死（CTO Design Review 98/100 + Apply 专项复核 100/100 + 实施全阶段落地）：
> ① **CN/DN 不修改原 Invoice 金额事实**——invoiceTotal / 行快照 / InvoiceSnapshot 一律不动（财务事实不可变），只允许 `Invoice.balanceAmount` 投影跟随 AR newBalance；
> ② **APPROVED ≠ APPLIED**——审批（Workflow）只回写投影（approvalStatus/approvedAt/approvedById），Apply 才是唯一修改 `AR.adjustedAmount/balanceAmount` 的入口；
> ③ **只有 Apply 创建 InvoiceAdjustment 并修改 AR.adjustedAmount**——InvoiceAdjustment 是事实中间层，客户端禁直接创建/编辑（只读）；
> ④ **CN 为负 adjustment（<0）、DN 为正 adjustment（>0）**——全系统唯一符号口径，AR.adjustedAmount = Σ signed adjustmentAmount；
> ⑤ **负 AR = Customer Credit projection**——balance < 0 时不新增 AccountsReceivableStatus.CREDIT 数据库状态（只做读取投影），且**禁止继续 Receipt Allocation / WriteOff**（两个既有入口已加门禁）。

## 1. 交付范围

### 1.1 API（4 端点，均在 `apps/web/src/app/api/**`）
| 分组 | 端点 | 说明 |
| --- | --- | --- |
| 调整单 | POST `/api/credit-debit-notes` | 创建（单票制 sourceInvoiceId 必填唯一；只接受已 ISSUED 的 Invoice；Customer/Currency 从原 Invoice 继承；行只传 sourceInvoiceLineId+quantity(>0)；金额快照复制不调 Pricing Engine；**不创建 InvoiceAdjustment、不改 AR、不改 Invoice.balanceAmount**；编号创建即取号 CN-/DN-2026-xxxx） |
| 调整单 | GET `/api/credit-debit-notes` | 列表（分页 + status/noteType/customerId 过滤；含 sourceInvoice 摘要 + lines；只读） |
| 动作 | POST `/api/credit-debit-notes/{id}/submit` | DRAFT → SUBMITTED（命中 CREDIT_DEBIT_NOTE 策略 → Workflow 触发 PENDING；未命中 → 可直接 Apply；**绝不修改 AR.adjustedAmount**；Workflow 配置异常事务回滚 409 CN_DN_WORKFLOW_FAILED） |
| 动作 | POST `/api/credit-debit-notes/{id}/apply` | **唯一修改 AR.adjustedAmount/balanceAmount 的入口**（APPROVED ≠ APPLIED；累计防超调锁内重算；signed adjustment 落 InvoiceAdjustment；负 AR 投影；Invoice.balanceAmount 跟随） |

### 1.2 RBAC（权限码，动作级，零新造）
credit-debit-note:create（创建）/ credit-debit-note:edit（submit）/ credit-debit-note:approve（Apply + workflow 终态回写）/ credit-debit-note:view
credit-debit-note-line:view / credit-debit-note-line:edit（行由单据驱动，客户端不直接改行）
invoice-adjustment:view（**系统事实层只读**，不开放 create/edit API）
（seed SEED_ACTION_MODULES 已注册 credit-debit-note；SEED_RESTRICTED_ACTION_PERMISSIONS 已注册 line view/edit + adjustment view）

### 1.3 Domain Events（EVENTS.md v1.12 注册 2.3.7 发票调整领域 5 个，4E-3 全部实现）
CreditDebitNoteCreated ✅ / CreditDebitNoteSubmitted ✅ / CreditDebitNoteApprovalStarted ✅ / CreditDebitNoteApproved ✅ / CreditDebitNoteRejected ✅
联动（Apply 时同时发布，EVENTS.md v1.12 注册）：**InvoiceAdjustmentApplied ✅ + AccountsReceivableAdjusted ✅**（后者 v1.9 已注册复用）

## 2. 测试要点（用户 #5703 指令：财务边界 + 并发场景全覆盖，质量优先于数量）

| # | 场景 | 验证方式 | 实现位置 |
| --- | --- | --- | --- |
| T1 | CN/DN Create **不落 InvoiceAdjustment** | POST /api/credit-debit-notes → InvoiceAdjustment 表无新增；AR.adjustedAmount 不变；Invoice.balanceAmount 不变 | credit-debit-notes/route.ts（边界①③） |
| T2 | Submit **不改 AR.adjustedAmount** | POST submit → AR.adjustedAmount/balanceAmount 前后一致 | [id]/submit/route.ts（边界②） |
| T3 | APPROVED 仍 ≠ APPLIED | Workflow COMPLETED → note.approvalStatus=APPROVED 但 status 仍 SUBMITTED、AR 未动 | workflow-sync syncCreditDebitNoteApproval（边界②） |
| T4 | Apply 才创建 InvoiceAdjustment | POST apply → InvoiceAdjustment 新增 N 行（每行一条 fact，signed），appliedAt 非空 | [id]/apply/route.ts（边界③） |
| T5 | **CREDIT → signed amount < 0** | CN Apply → InvoiceAdjustment.adjustmentAmount 为负；AR.adjustedAmount 减少 | apply 事务（边界④） |
| T6 | **DEBIT → signed amount > 0** | DN Apply → InvoiceAdjustment.adjustmentAmount 为正；AR.adjustedAmount 增加 | apply 事务（边界④） |
| T7 | 同一 InvoiceLine 多张 CN 累计 quantity 防超调 | 原行 100：CN#1=60 Apply ✅、CN#2=60 Apply → 409 CN_DN_QUANTITY_EXCEEDED（remaining=40） | apply 累计防超调（锁内重算） |
| T8 | **两张 CN 并发 Apply 不穿透** | 原行 100：两张 CN（各 60）并发 Apply → 至多一张成功，另一张 409（第二个事务等锁后重读累计） | apply 锁序 InvoiceLine id ASC FOR UPDATE |
| T9 | DN 累计金额 ceiling | 原行金额 1000：DN#1=600 Apply ✅、DN#2=600 Apply → 409 CN_DN_AMOUNT_EXCEEDED（ceiling=1000） | apply 金额 ceiling（同类型聚合） |
| T10 | **CN/DN 同类型独立累计，不互相污染** | CN=-600 后 DN=+600 → 各自 ceiling 独立计算（DN 累计 600+600=1200 > 1000 仍拒绝；CN 累计不受 DN 影响） | apply 金额按同类型聚合 |
| T11 | Invoice 原始 invoiceTotal / InvoiceLine / Snapshot 不变 | Apply 前后 Invoice.invoiceTotal、InvoiceLine.quantity/unitPrice/lineAmount/taxAmount/totalAmount、InvoiceSnapshot 全部不变 | apply 只更新 balanceAmount 投影（边界①） |
| T12 | **Invoice.balanceAmount = AR newBalance** | Apply 后 Invoice.balanceAmount == AR.balanceAmount（computeBalance 单入口直写） | apply Invoice 投影 |
| T13 | 全额付款后 CN → AR 负余额 | Invoice 1000 已收清（balance=0）→ CN -200 Apply → AR.balanceAmount=-200（Customer Credit） | apply computeBalance（边界⑤） |
| T14 | 负 AR 不新增 CREDIT 数据库状态 | AR.balanceAmount=-200 → status 仍 OPEN/PARTIALLY_PAID 等既有枚举，**无 AccountsReceivableStatus.CREDIT** | computeArStatus + schema（边界⑤） |
| T15 | 负 AR 不参与 Aging | balance<0 → computeArProjection 不产 aging bucket（只对 balance>0 计算） | projection.ts（读取投影） |
| T16 | **负 AR 禁止 Receipt Allocation** | AR.balanceAmount<0 → POST allocate → 409 RECEIPT_AR_NEGATIVE_BALANCE | receipts/[id]/allocate/route.ts（门禁） |
| T17 | **负 AR 禁止 WriteOff** | AR.balanceAmount<0 → POST write-offs/{id}/apply → 409 WRITE_OFF_AR_NEGATIVE_BALANCE | write-offs/[id]/apply/route.ts（门禁） |
| T18 | DN 可以把负余额向 0 拉回 | AR=-200 → DN +200 Apply → balance=0（DN 累计 200 ≤ ceiling，合法） | apply DEBIT 分支 |
| T19 | 重复 Apply → 409 CN_DN_ALREADY_APPLIED | 同一 Note 二次 Apply → 409（幂等稳定） | apply 状态门禁 |
| T20 | 未审批 Apply → 409 | 命中策略且 approvalStatus≠APPROVED → Apply → 409 CN_DN_APPROVAL_REQUIRED | apply 状态门禁 |
| T21 | Workflow 失败 → Submit 整体回滚 | 命中策略但 WorkflowDefinition 缺失 → submit → 409 CN_DN_WORKFLOW_FAILED，Note 保持 DRAFT | [id]/submit/route.ts（事务回滚） |

## 3. Apply 事务红线（CTO 98/100 + Apply 专项复核 100/100 锁定顺序，Final Review 检查点）

```
Lock CreditDebitNote（FOR UPDATE）
 ↓
状态门禁：APPLIED → 409 CN_DN_ALREADY_APPLIED（幂等稳定 409）
         非 SUBMITTED → 409 CN_DN_INVALID_STATE
         命中审批但未 APPROVED → 409 CN_DN_APPROVAL_REQUIRED
         无策略 → 可直接 Apply
 ↓
Lock Invoice（FOR UPDATE）
 ↓
Lock source InvoiceLines（按 id ASC，FOR UPDATE——防死锁锁序）
 ↓
Lock AccountsReceivable（FOR UPDATE）
 ↓
校验 customerId / currency 与 AR 一致（409 CN_DN_SOURCE_NOT_COMPATIBLE）
 ↓
累计 CN/DN 防超调（锁内重算）：
  CREDIT：remainingAdjustableQty = originalInvoiceLine.quantity - cumulativeAppliedCreditQty
          newCreditQty ≤ remainingAdjustableQty（否则 409 CN_DN_QUANTITY_EXCEEDED）
  金额：累计已 APPLIED 未 reversed 调整金额（**同类型** abs）+ 本次 ≤ 原行金额 ceiling
        （否则 409 CN_DN_AMOUNT_EXCEEDED；DN 第一版禁超原行金额）
 ↓
Create InvoiceAdjustment facts（signed adjustmentAmount：CN<0 / DN>0；部分行按数量比例折算快照金额，不重算、不调 Pricing Engine）
 ↓
AR.adjustedAmount += Σ signed adjustmentAmount（服务端聚合）
 ↓
AR.balanceAmount = computeBalance(...)（单入口：original + adjusted - paid - writeOff）
 ↓
AR status = computeArStatus(...)（统一口径；负 AR 不新增 CREDIT 状态，只做读取投影）
 ↓
Invoice.balanceAmount = AR newBalance（**Invoice 金额事实不动**：invoiceTotal/行快照/InvoiceSnapshot 一律不改）
 ↓
AR Revision + Snapshot（snapshotSource=ADJUSTMENT / snapshotType=ADJUSTED）
 ↓
CreditDebitNote = APPLIED + appliedAt/appliedById
 ↓
Audit / Events（事务外：InvoiceAdjustmentApplied + AccountsReceivableAdjusted 同时发布，失败降级不阻断；DB 事实更新不因事件失败回滚）
```

## 4. 手工验收清单（合并前逐项确认）

- [ ] 4 端点 OpenAPI 描述含 5 条财务边界（已写入 openapi.yaml Sprint 4E-3 段）
- [ ] InvoiceAdjustment 在 OpenAPI 为只读 schema，无 create/edit 端点
- [ ] Apply 事务 15 步锁序与 ADR-0022 §6 一致（复核 100/100 已确认）
- [ ] 负 AR 门禁在 Receipt Allocation / WriteOff Apply 两个既有入口真实生效（409 错误码）
- [ ] CREDIT/DN 符号口径全系统唯一（InvoiceAdjustment.adjustmentAmount signed）
- [ ] Invoice.balanceAmount 只跟随 AR newBalance，invoiceTotal/行快照/Snapshot 未动
- [ ] Workflow 终态回写（syncCreditDebitNoteApproval）绝不碰 AR

## 5. 红线核验（Final Review 检查项）

| 检查项 | 结果 |
| --- | --- |
| APPROVED ≠ APPLIED（审批只回写投影） | ✅ apply 路由状态门禁 + workflow-sync 只回写 approvalStatus |
| Apply 唯一修改 AR.adjustedAmount 入口 | ✅ 全仓无第二处写 adjustedAmount（禁 PATCH） |
| CN<0 / DN>0 signed 落 InvoiceAdjustment | ✅ lineTotal.negated() / lineTotal |
| 累计防超调锁内重算（同类型聚合） | ✅ apply 锁内读 InvoiceAdjustment + 按 noteType 过滤 |
| 负 AR 不新增 CREDIT 状态 | ✅ schema 无 AccountsReceivableStatus.CREDIT；computeArStatus 五态 |
| 负 AR 禁 Receipt Allocation / WriteOff | ✅ RECEIPT_AR_NEGATIVE_BALANCE / WRITE_OFF_AR_NEGATIVE_BALANCE |
| Invoice 金额事实不可变 | ✅ 只写 balanceAmount 投影（4E-2 修复后口径） |
| 重复 Apply 幂等 409 | ✅ CN_DN_ALREADY_APPLIED |
| Decimal 全程无 Float/Number | ✅ 金额快照/调整金额/余额全 Prisma.Decimal + toString |
