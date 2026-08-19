# Sprint 7 — GL 过账消费 5C 事件 QA 验收记录（Finance 首块，ADR-0033）

- 日期：2026-08-20
- 关联：ADR-0033、ADR-0031（事件 Outbox 前置）、ADR-0027（D8 GL 边界）、docs/frontend/contract-cards/gl-posting-gate.md
- 状态：**CI 验证通过（GitHub Actions 全绿）；Runtime Acceptance = 待生产部署后执行（CI-First，本地不跑 runtime）**

## 1. 范围

| 提交 | 内容 | CI |
|---|---|---|
| GL 首块（Migration 0033） | GlAccount/GlJournalEntry/GlJournalEntryLine + posting 服务 + consumer 4 事件 handler + 查询 API + 前端只读页 + seed 科目 | ✅ success（待 CI 确认） |

## 2. 静态验收（本地已核）

- [x] Migration 0033 与 schema 一致（3 表 + 索引 + FK）；生产迁移顺序 0028→…→0033
- [x] 借贷平衡 Σdebit=Σcredit（服务端 Decimal 精确校验，不平衡 409 GL_UNBALANCED）
- [x] 幂等：GlJournalEntry @@unique(sourceType, sourceId)（重复消费 → 跳过）；每行恰一侧 > 0
- [x] 科目存在 fail closed（缺失 → 拒绝过账，不静默降级）
- [x] POSTED 一次性终态不可变（纠错 → 追加红字冲销，不手改）
- [x] consumer handler + Outbox PROCESSED 同事务（失败回滚重试；GL 事件注册 4 个）
- [x] 权限：gl:view 查询；会计敏感仅 SUPER_ADMIN/ADMIN（ALL_ACTION_PERMISSIONS 自动含 gl:*）
- [x] 前端只读消费后端契约（无手工过账 UI——事件驱动）

## 3. 需在生产 Runtime 验收（部署后执行）

- [ ] 发票 POST → consume 事件 → GL 凭证自动生成（借 采购+进项税 贷 应付）
- [ ] 付款 apply → GL 凭证（借 应付 贷 银行）；CN/DN apply → 调整凭证；付款 reverse → 冲销凭证
- [ ] 重复 consume → 幂等跳过（不重复过账）；借贷不平衡事件 → 409/DEAD_LETTER 可查
- [ ] 权限：MANAGER 访问 /api/gl/* → 403

## 4. 已知限制 / 边界

- GL 余额/试算平衡/利润表未实现（后续 backlog）；GRIR 暂估/冲回不过账；无手工录入/审核流 UI
- reports（BI）仍 HOLD（待 20 份报表清单）

## 5. 验收人

- CI 验证：GitHub Actions（Quality Gates / Secret Scanning / Build）
- Runtime Acceptance：待生产部署后由 CIO/CTO 执行（本 Gate 未执行，如实声明）
