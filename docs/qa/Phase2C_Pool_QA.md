# Phase 2C 客户公海 QA（2C-1 Pool Foundation + 2C-2 Claim/Rules/UI）

> 日期：2026-08-25 ｜ ADR-0053 APPROVED + CTO OQ 裁决（2C-1 → 2C-2 连续开发，无中间授权）
> 验证事实源：GitHub CI + 人工 Runtime Acceptance（AI 不机械勾选）

## 范围

- 2C-1：Migration 0049（CustomerPool/CustomerPoolRule/CustomerPoolEntry/CustomerOwnership；Entry→Ownership 1:N；
  Entry/Ownership 无 isActive；手写 partial unique I1/I2；禁 (poolId,businessPartnerId) 重复 index）+ RBAC
  （customer-pool:view/create/edit/delete/assign + customer-pool:consume SYSTEM，PERMISSION_MODULES+seed 同 PR）+ 错误码
  （POOL_*，INACTIVITY → POOL_RULE_SOURCE_UNAVAILABLE）+ pools/rules/entries API（手工入池全校验 + Outbox 同事务）
- 2C-2：claim/release（单事务行锁 + Outbox）+ **自动匹配（matchCustomerPools：REGION scopeValue === BP.region 触碰 +
  DEPARTMENT scopeValue === CustomerOwnership.ownerId → User.departmentId 触碰 → FIELD_RULE 自动入池；BP create/update +
  claim 后同步调用，best-effort 失败不回滚主档/claim）** + Customer 360 公海真实能力 + Customer Pool Workspace
- **本 PR HOLD（不在本 MVP）**：evaluateCustomerPoolRules 规则引擎（FIELD_MATCH condition EQ/IN 白名单）、多池 priority 仲裁
  （同 priority NO AUTO ENTRY + ambiguous）、sweep（batch/FOR UPDATE SKIP LOCKED/统计）
- 不在范围：INACTIVITY 规则（Phase 3 前禁）；Region/Team 模型；BP 加 ownerId/customerStatus；approval workflow（OQ-5）；quota/cooldown（OQ-2）

## CI 验证（已 PASS）

- 单测：validators（scope/rule 白名单/INACTIVITY/eligible）、pools route（CRUD/scope/code 冲突/P2002/CAS）、
  rules route（INACTIVITY 400/白名单/404）、entries route（全校验/Outbox 同事务/并发 P2002）、
  match（自动匹配 13 用例：REGION/DEPARTMENT 触碰入池 + Outbox / 无命中池 / 无 region / 无部门 / I2 / I1 / DEPARTMENT 优先 /
  MATCH_CONDITION_CHANGED / SUPPLIER / 未找到 / P2002 RACE_LOST）、
  business-partners route（create 后 matchCustomerPools 钩子）、claim route（claim 后 matchCustomerPools 触发钩子）
- PR：（待填）Quality/Build/Secret 三闸全绿

## Runtime Acceptance（人工执行，未机械勾选）

> 环境 / build SHA / 执行人 / 日期：（待填）。2C 完成后单独 Smoke（不阻塞 2B/2A Evidence）。

| # | 验证项 | 结果 |
|---|---|---|
| RC-1 | 创建 GLOBAL / REGION / DEPARTMENT 池 | [ ] |
| RC-2 | GLOBAL+scopeValue / REGION 缺 scopeValue → 400 | [ ] |
| RC-3 | 池编辑（version CAS；409 冲突提示）与软删 | [ ] |
| RC-4 | 创建 FIELD_MATCH 规则（region/type/isActive 等白名单） | [ ] |
| RC-5 | 创建 INACTIVITY 规则 → 400（Phase 3 前禁用提示） | [ ] |
| RC-6 | 手工入池 CUSTOMER 客户 → 201 + 状态 IN_POOL | [ ] |
| RC-7 | 手工入池 SUPPLIER 客户 → 400 | [ ] |
| RC-8 | REGION/DEPARTMENT scope 不匹配 → 400 | [ ] |
| RC-9 | 已有 active ownership/entry 再入池 → 409 | [ ] |
| RC-10 | claim 挑入（entry=CLAIMED + ownership 生成 + 当前 owner 显示） | [ ] |
| RC-11 | release 回池 / 移出池（两种语义） | [ ] |
| RC-12 | 自动入池规则触发（BP 字段变化 → 自动进池） | [ ] |
| RC-13 | 多池同 priority 命中 → 不自动入池 + ambiguous 标记 | [ ] |
| RC-14 | sweep 返回统计（scanned/entered/unchanged/ambiguous/blocked/failed） | [ ] |
| RC-15 | Customer 360 显示归属/池状态/owner/claim/release/history | [ ] |
| RC-16 | Customer Pool Workspace（池列表/规则编辑/entries/claim） | [ ] |
| RC-17 | 无 customer-pool:assign 权限 → claim/入池 403 | [ ] |
| RC-18 | 并发双 claim → 仅一个成功（409 POOL_CLAIM_CONFLICT） | [ ] |

## 边界

- 零修改 BusinessPartner（禁 ownerId/customerStatus）；零 Legacy Customer；零 INACTIVITY 实现；
  零 approval workflow；零 quota/cooldown；零新 Region/Team 模型
- 自动匹配（本线收口）：REGION（scopeValue === BP.region）+ DEPARTMENT（CustomerOwnership.ownerId → User.departmentId === scopeValue，
  BP 无部门真实字段，归属 SSOT = CustomerOwnership）均自动入池（FIELD_RULE + Outbox 同事务）；GLOBAL 不自动入池；
  claim（客户负责人变更）后同步触发匹配；FIELD_MATCH condition 评估 / priority 仲裁 / sweep 仍 HOLD
- 客户级 owner 唯一权威 = CustomerOwnership（SSOT 红线）
