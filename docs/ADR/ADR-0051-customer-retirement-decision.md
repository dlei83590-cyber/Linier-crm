# ADR-0051：Customer Retirement Decision（遗留 Customer 模型处置）

- 状态：**Accepted（Governance，2026-08-24）**
- 日期：2026-08-24
- 维护者：CTO（AI Agent 代理执行）｜审核：CTO
- 关联：docs/reviews/Contract_Feature_Coverage_Audit_2026-08-24.md（Phase 0）；ADR-0050（SSOT 冻结）；CTO Directive Phase 1C

---

## 决策

**结论：DEPRECATE（保留兼容窗口，禁止 DROP；删除另开 Migration Gate）**

| 对象 | 决策 | 说明 |
|---|---|---|
| Customer（模型 + CustomerContact/Address/Tag/Credit 子模型） | DEPRECATE | 零业务引用（业务单据全指向 BusinessPartner）；保留模型不 DROP |
| /api/customers 全套路由（9 个） | DEPRECATE（兼容窗口） | 前端消费已清零（P0-1）；保留路由供历史外部消费者兼容，标记 deprecated |
| shared 权限模块 customer（customer:view/create/edit...） | DEPRECATE | 保留权限码（历史 API 引用），不再授权新功能使用 |

## 依赖矩阵（Dependency Matrix）

| 维度 | 对象 | 状态 |
|---|---|---|
| relation | CustomerContact / CustomerAddress / CustomerTag / CustomerCredit（仅被 Customer 引用，零业务反向引用） | 仅自引用 |
| API | /api/customers route + [id] + [id]/addresses + [id]/contacts + [id]/credit + [id]/tags（+ 各 [itemId] 子路由）= 9 文件 | 存活，零前端消费 |
| UI | （无）——前端已迁移 business-partners（P0-1） | 已清零 |
| import | 无前端 import；仅 API 路由内部 import prisma.customer | 无 |
| seed | 无 Customer seed（seed.ts 零引用） | 无历史 seed |
| test | 无 Customer 模型测试（customer-options.test.ts 属 BusinessPartner 选择器，非 Customer 模型） | 无 |
| migration/history | Customer 建表于 Migration 0013（project_foundation，Sprint 2B/3C-1 历史） | 保留（不可变） |

## 处置分类（CTO Phase 1C 四类）

- **A. 可直接删除的 dead code**：无（/api/customers 路由仍被 shared customer 权限模块 + prisma.customer 引用）
- **B. 需兼容窗口的 legacy API**：/api/customers 9 路由 + shared customer 权限模块 → DEPRECATE（保留，标记 deprecated，未来移除）
- **C. 需数据迁移的 historical facts**：生产 DB 可能存在早期 Sprint 3C-1 创建的历史 Customer 记录（seed 无，但历史运行可能产生）→ 迁移前必须先 backfill 评估（Customer.partnerId 已可选关联 BusinessPartner）
- **D. 仍有独立业务语义的模型**：无（BusinessPartner 已全覆盖客户/供应商主体 + 子资源）

## 执行边界（本 Phase）

- 禁止 DROP Customer table / 子模型（删除另开 Migration Gate + 数据迁移评估）
- 不新增任何写入旧 Customer SSOT 的功能；新 CRM 功能一律 BusinessPartner.id
- 可选：在 /api/customers 路由注释标记 deprecated（治理标记，零行为变更）

## 后续（Drop-Later Migration Gate 前置条件）

- 生产 DB Customer 表数据量核对（空 → 可评估 DROP；非空 → 设计 backfill 到 BusinessPartner 的迁移）
- /api/customers 访问日志确认零调用（观察窗口）
- 移除 shared customer 权限模块 + /api/customers 路由 + Customer 模型（一次 Migration Gate）