# ADR-0035：GL 手工凭证录入 + 审核流（maker-checker UI）

- 状态：**Accepted**（CTO 解锁 Sprint 7 Finance；2026-08-20）
- 日期：2026-08-20
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：ADR-0033（GL 过账）、ADR-0034（余额/试算/利润）、4D Invoice 教训（DRAFT 不占号）、ADR-0028（权限）

---

## 背景

ADR-0033/0034 落地 GL 自动过账（事件驱动）与只读查询。剩余闭环 = 手工录入凭证（调整/更正/杂项，非事件来源）+ 审核流（maker-checker）。

## 决策

1. **手工凭证状态机**：DRAFT → SUBMITTED → APPROVED → POSTED / REJECTED
   - DRAFT：创建人录入/编辑（借贷行整体替换，version CAS）
   - SUBMITTED：提交待审（不可编辑）
   - APPROVED：审核通过（approver ≠ creator——maker-checker ①）
   - POSTED：终态不可变（poster ≠ creator——maker-checker ②；POSTED 时取号）
   - REJECTED：审核驳回（可编辑回 DRAFT 语义，version CAS）
2. **取号时点（对齐 4D 教训）**：DRAFT 不占号（voucherNo=NULL）；APPROVED→POSTED 时原子取号（DocumentSequence docType=JOURNAL；事务回滚则号不消耗——nextNo 增量在事务内）。
3. **幂等/来源**：手工凭证 sourceType='MANUAL' + sourceId=cuid()（创建时生成，@@unique(sourceType,sourceId) 天然唯一，不冲突自动过账）。
4. **借贷平衡**：创建/编辑/POST 均复用服务端 Decimal 校验（Σdebit=Σcredit、每行恰一侧 > 0、科目存在 fail closed）。
5. **API**：
   - POST /api/gl/journal-entries/manual（创建 DRAFT；body: postingDate/summary/lines[{accountCode,debit,credit,summary}]）
   - PATCH /api/gl/journal-entries/:id（DRAFT or REJECTED only；summary/lines 整体替换 + version CAS）
   - POST /:id/submit（DRAFT→SUBMITTED；权限 gl:edit）
   - POST /:id/approve（SUBMITTED→APPROVED；权限 gl:approve；approver ≠ creator）
   - POST /:id/post（APPROVED→POSTED；权限 gl:create 或 gl:edit；poster ≠ creator；取号）
   - POST /:id/reject（SUBMITTED→REJECTED；权限 gl:approve；rejecter ≠ creator）
6. **权限（ADR-0028）**：gl 模块已有（view/create/edit/close…）；approve 映射 gl:approve（∈ ALL_ACTION_PERMISSIONS）；会计敏感仅 SUPER_ADMIN/ADMIN。
7. **前端**：/finance/gl-journal-entries/new（手工录入：日期/摘要/借贷行动态增删 + 借贷合计实时校验）+ detail 页状态机按钮（submit/approve/post/reject 按状态显隐，消费后端状态契约）。

## 影响

- Migration 0034：GlJournalEntry.voucherNo 改可空（DRAFT 不占号）+ approvedAt/approvedById 字段
- 手工凭证与自动过账共用 GlJournalEntry/Line（同一事实表）；sourceType 区分（MANUAL vs 事件）
- 自动过账路径不变（POSTED 一次性）

## 后续（独立 backlog）

- ~~期初余额 + 期末结转（month-end close）~~ ✅（2026-08-20，ADR-0036：GlPeriodClose + closePeriod + openingBalance 派生）
- 多币种折算 / 合并报表
- 成本核算（D9 HOLD 延续）
