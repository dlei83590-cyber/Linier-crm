# Sprint 5C-2 — QA 验收记录（Supplier CN/DN + Payment Allocation）

- 日期：2026-08-19
- 关联：ADR-0030、docs/frontend/contract-cards/supplier-cn-dn-payment-allocation-gate.md、EVENTS v1.34、CHANGELOG [Unreleased]
- 状态：**CI 验证通过（Batch 1 `b0d68e7` / Batch 2 `9be51c5` 全绿）；Runtime Acceptance = 待生产部署后执行（CI-First，本地不跑 runtime）**

## 1. 范围

| Batch | 提交 | 内容 | CI |
|---|---|---|---|
| 1 | f9e93de→b0d68e7 | Supplier CN/DN（Migration 0029 + 4 routes + apply 事务 + 前端 3 页 + 事件） | ✅ success（经反向字段/类型修复） |
| 2 | 70b494a→9be51c5 | Payment Allocation（Migration 0030 + 5 routes + apply 事务 + 前端 3 页 + 事件） | ✅ success（经 lint 修复） |

## 2. 静态验收（本地已核）

- [x] Migration 0029/0030 与 schema 一致（枚举/表/索引/FK）；生产迁移顺序 0028→0029→0030
- [x] 并发锁序：CN/DN apply 与 Payment apply 均为「业务头 FOR UPDATE → ApOpenItem FOR UPDATE」（一致，防死锁）
- [x] 累计防超调/防超核销锁内重算（CREDIT 不得使 openAmount<0；核销 ≤ openAmount 且 ≤ 未核销余额）
- [x] maker-checker 业务层强制（appliedById/allocatedBy ≠ createdById）
- [x] 幂等（已 APPLIED/已反转 → 409）；不可变事实（APPLIED 后禁改；reversal 追加不手改 openAmount）
- [x] 同供应商同币种硬规则（Payment 核销）
- [x] 权限（ADR-0028）：3 个新模块 ∈ ALL_ACTION_PERMISSIONS；仅 SUPER_ADMIN/ADMIN（会计敏感）
- [x] 事件仅事务提交后发布（AuditLog 留痕）
- [x] 前端状态机按钮消费后端状态契约（APPROVED ≠ APPLIED、ALLOCATED ≠ CREATED）

## 3. 需在生产 Runtime 验收（部署后执行）

- [ ] CN/DN：创建（选 POSTED 发票）→ submit → 审批（Workflow）→ apply（Open Item 投影更新）；重复 apply 409
- [ ] CN/DN：CREDIT 超冲减 → 409 OVER_ADJUSTMENT（负 AP 防线）
- [ ] Payment：创建 → apply（核销 UNPAID Open Item）→ 投影与状态更新；重复核销防超 409
- [ ] Payment：同供应商/同币种违规 → 409；void（UNALLOCATED only）；allocation reverse 纠错
- [ ] maker-checker：创建人执行 apply/核销 → 409
- [ ] 权限：MANAGER 访问 5C-2 端点 → 403

## 4. 已知限制 / 边界

- 不建 GL（D8）；付款单整体冲销/红字付款未实现（后续 backlog）
- CN/DN 单票制（跨票 Consolidated 延后）
- 5C-2 事件经 AuditLog 留痕（事件总线未落地，Known Risk）
- reports 保持信息架构（待 20 份报表清单）

## 5. 验收人

- CI 验证：GitHub Actions（Quality Gates / Secret Scanning / Build）
- Runtime Acceptance：待生产部署后由 CIO/CTO 执行（本 Gate 未执行，如实声明）