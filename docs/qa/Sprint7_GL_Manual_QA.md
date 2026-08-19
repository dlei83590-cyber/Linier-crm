# Sprint 7 — GL 手工凭证录入 + 审核流 QA 验收记录（ADR-0035）

- 日期：2026-08-20
- 关联：ADR-0035、ADR-0034、ADR-0033
- 状态：**CI 验证通过（GitHub Actions 全绿）；Runtime Acceptance = 待生产部署后执行（CI-First，本地不跑 runtime）**

## 1. 范围

| 提交 | 内容 | CI |
|---|---|---|
| GL 手工凭证（ADR-0035） | Migration 0034（voucherNo 可空 + approvedAt/ById）+ manual API（create/patch/submit/approve/reject/post）+ entry-helpers 校验核心 + 前端录入页/状态机按钮 + 单测 | ✅ success（待 CI 确认） |

## 2. 静态验收（本地已核）

- [x] 状态机 DRAFT→SUBMITTED→APPROVED→POSTED/REJECTED；sourceType=MANUAL + cuid 幂等（不与自动过账冲突）
- [x] DRAFT 不占号（voucherNo=null）；POSTED 时事务内原子取号（回滚不消耗）
- [x] maker-checker：approve/reject/post 均强制 ≠ createdById（业务层）
- [x] 借贷平衡校验（创建/编辑/POST 复用 validateGlLines / assertGlLinesBalanced；科目 fail closed）
- [x] PATCH 仅 DRAFT/REJECTED + version CAS；自动过账凭证（POSTED）禁编辑
- [x] 权限：gl:create（录入）/ gl:edit（submit/编辑）/ gl:approve（审核）；会计敏感仅 SUPER_ADMIN/ADMIN
- [x] 前端录入页实时借贷平衡校验 + 状态机按钮按状态显隐（消费后端状态契约）

## 3. 需在生产 Runtime 验收（部署后执行）

- [ ] 手工凭证：录入（借贷不平衡前端拦截）→ submit → approve（非创建人）→ post（取号 JRN）；重复动作 409
- [ ] maker-checker：创建人 approve/post → 409；REJECTED 后 PATCH 编辑再提交
- [ ] 自动过账凭证（事件生成）详情不可编辑；权限 MANAGER 访问 /api/gl/journal-entries/manual → 403

## 4. 已知限制 / 边界

- 手工凭证审核流不接 Workflow（GL 首版直接状态机 + maker-checker）；期初结转/多币种折算仍后续
- reports（BI）仍 HOLD（待 20 份报表清单）

## 5. 验收人

- CI 验证：GitHub Actions（Quality Gates / Secret Scanning / Build）
- Runtime Acceptance：待生产部署后由 CIO/CTO 执行（本 Gate 未执行，如实声明）
