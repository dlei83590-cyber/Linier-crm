# ADR-0030：5C-2 Supplier CN/DN + Payment Allocation（CTO 解锁）

- 状态：**Accepted**（CTO 授权解锁 2026-08-19；Design/Scope Gate → 两批实现已合入 main）
- 日期：2026-08-19
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：ADR-0027（D6/D7/D8/D12）、ADR-0028（API referenced permission ⊆ ALL_ACTION_PERMISSIONS）、docs/frontend/contract-cards/supplier-cn-dn-payment-allocation-gate.md、5C-1（SupplierInvoice/ApLiabilityFact/ApOpenItem FINAL）、EVENTS v1.34

---

## 背景

CTO 授权解锁 5C-2（Supplier Payment / AP Allocation / Supplier CN-DN）HOLD。5C-1 已 FINAL（SupplierInvoice POSTED 同事务产生 ApLiabilityFact + ApOpenItem 投影）。本 ADR 记录 5C-2 的边界决策与两批实现。

## 决策

1. **Supplier CN/DN（Migration 0029，Batch 1）**：AP 侧独立事实（与 4E-3 销售侧 CN/DN 模型独立，方向相反）——`SupplierCreditDebitNote`（noteType CREDIT/DN，单票制 sourceSupplierInvoiceId 须 POSTED）+ `SupplierCreditDebitNoteLine`（来源发票行快照，金额服务端计算）；DocumentType 扩展 `SUPPLIER_CREDIT_NOTE/SUPPLIER_DEBIT_NOTE`（创建即取号 fail closed）；状态机 DRAFT→SUBMITTED→APPROVED→APPLIED/CANCELLED；**APPLIED 同事务重算 ApOpenItem.openAmount 投影**（= Liability + Σsigned(CN/DN) − ΣAllocations，服务端 Decimal）
2. **Payment Allocation（Migration 0030，Batch 2）**：`SupplierPayment`（付款事实，code 取号 PAYMENT_VOUCHER；allocatedAmount/unallocatedAmount/status 受控投影禁止 PATCH）+ `SupplierPaymentAllocation`（核销行，reversal 纠错留痕）；**Apply 唯一回写入口**（Created ≠ Applied）：创建核销行 + payment 投影 + ApOpenItem.openAmount 投影（同事务）
3. **业务不变量（两模块统一）**：
   - 累计防超调/防超核销（CREDIT 不得使 openAmount < 0；核销 ≤ openAmount 且 ≤ 未核销余额）——锁内重算
   - 并发锁序（Blocking Gate）：先锁业务头 FOR UPDATE → 再锁目标 ApOpenItem FOR UPDATE（CN/DN apply 与 Payment apply 完全一致，防死锁）
   - maker-checker（业务层强制：appliedById/allocatedBy ≠ createdById）
   - 幂等（已 APPLIED/已反转 → 409）；不可变事实（APPLIED 后禁改，纠错追加新事实/reversal，不手改 openAmount）
   - 同供应商同币种（Payment 核销硬规则）
4. **权限（ADR-0028）**：新增 `supplier-credit-debit-note` / `supplier-payment` / `supplier-payment-allocation` 模块（shared PERMISSION_MODULES + seed）；**会计敏感仅 SUPER_ADMIN/ADMIN 静态授权**（与 supplier-invoice 一致，MANAGER 无）；apply→:edit / void→:close 复用统一 RBAC（不新造 apply/void 权限码，maker-checker 业务层强制）
5. **事件（EVENTS v1.34）**：`SupplierCreditDebitNoteApplied` / `SupplierPaymentApplied`（AuditLog 留痕，事务提交后发布；载荷不含可变投影之外中间态）
6. **GL 边界（ADR-0027 D8 延续）**：5C-2 只产出财务事实/事件，不建 GL 总账、不过账

## 影响

- Migration 0029 + 0030（新增 4 表 + 3 枚举 + DocumentType +2）；生产迁移顺序 0028 → 0029 → 0030
- 前端：/supplier-ap/credit-debit-notes（list/new/detail + submit/apply）与 /supplier-ap/payments（list/new/detail + apply/void）；registry supplier-cn-dn / payment-allocation hold→ready
- ApOpenItem.openAmount 投影由 CN/DN apply 与 Payment apply 共同维护（服务端增量更新，version CAS 归 reconciliation 服务）
- **reports（BI）保持信息架构**（Report Catalog Mapping Gate 前置，待 20 份源报表清单；不实现指标）

## 后续（独立 backlog）

- ~~Payment 整体冲销~~ ✅（2026-08-19 已实现：Migration 0031 + POST /:id/reverse + SupplierPaymentReversed 事件；核销反转 + 整体冲销均齐）
- Supplier CN/DN 跨票 Consolidated 调整（当前单票制）
- GL 过账消费 5C 事件（Finance 阶段）
- ADR-0028 CI 静态 Gate（独立 Governance backlog）