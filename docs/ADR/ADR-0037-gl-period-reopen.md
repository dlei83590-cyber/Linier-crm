# ADR-0037：GL 期间解锁/重开（period reopen）

- 状态：**Accepted**（CTO 解锁 Sprint 7 Finance；2026-08-20）
- 日期：2026-08-20
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：ADR-0036（期末结转）、ADR-0033（GL 凭证不可变）、ADR-0035（纠错纪律）

---

## 背景

ADR-0036 已实现期末结转（GlPeriodClose 防重复月结）。业务上可能需要**解锁已结转期间**（更正/补录凭证后重新结转）。GL 凭证不可变纪律（ADR-0033）要求纠错只能追加新事实，不能删改已过账凭证。

## 决策

1. **重开 = 红字冲销 + GlPeriodClose 失效**：
   - 生成红字冲销凭证：sourceType=`PERIOD_CLOSE_REVERSAL`，sourceId=`periodKey|reopen|{timestamp}`，**分录 = 原结转凭证的逐行反向**（debit↔credit），借贷平衡（数学保证）。
   - **不删除原结转凭证**（不可变纪律）；冲销凭证进入 GlJournalEntry，余额/试算自动回滚。
   - **删除 GlPeriodClose 记录**（允许该期间重新结转）；审计经冲销凭证 + AuditLog 留痕。
2. **幂等**：重开前锁结转记录（SELECT FOR UPDATE）；GlPeriodClose 已不存在 → 409 GL_PERIOD_NOT_CLOSED；冲销凭证 @@unique(sourceType, sourceId) 防重复（timestamp 唯一）。
3. **API**：`POST /api/gl/period-closes/:id/reopen`（gl:create；重开人与原 closedBy 关系不强制——重开属管理操作，maker-checker 由结转/手工凭证审核流承载）。
4. **前端**：period-close 页已结转列表每行"重开"按钮（确认后调用）。
5. **边界**：重开期间后，该期间可再次执行 month-end-close（重新结转）；历史期间多轮 结转→重开→结转 均保留事实链（每轮冲销+结转凭证独立）。

## 影响

- 零 Migration（无 schema 变更；复用 GlJournalEntry/Line + GlPeriodClose）
- 冲销凭证源 type=PERIOD_CLOSE_REVERSAL，试算/余额自动包含（派生聚合）
- 多币种折算/合并报表**不实施**（CTO 2026-08-20 拍板：系统仅中国市场，单币种 CNY）

## 后续（独立 backlog）

- ~~多币种折算 / 合并报表~~ **不实施**（中国市场单币种 CNY）
- 成本核算（D9 HOLD 延续）
