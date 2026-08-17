# ADR-0028：Static RBAC Catalog Consistency（API referenced permission ⊆ ALL_ACTION_PERMISSIONS）

- 状态：**Accepted**（治理规则采纳；CI 静态 Gate 实现 = 独立 Governance backlog，本轮不实现）
- 日期：2026-08-17
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：PR #75（fix(rbac) `dcefea3e`）、docs/qa/B2-2_Runtime_QA.md、CHANGELOG（B2-2A/B2-2B 条目）
- 触发：B2-2A/B2-2B Runtime Acceptance 首次 smoke 在 `ee4d6ff` 上 Budget/Expense/Progress 全 403（SUPER_ADMIN 被拒）

---

## 背景（Runtime Blocking ①）

B2-2A/B2-2B 代码 CLOSED 且部署后，16 项联合 smoke 在 Production `ee4d6ff` 上全部写操作返回：

```
403 FORBIDDEN "Insufficient permission"（SUPER_ADMIN token）
```

capabilities 投影同步佐证：`budgets/expenses/progresses/products/tags` 全为 `false`（同一 hasPermission 源）。

## 根因

`packages/shared/src/constants/index.ts` 的 **`PERMISSION_MODULES` 缺注册 17 个 seed-only 模块**：

- Project 侧：`project-budget / project-expense / project-product / project-progress / project-acceptance / project-closure / project-tag / project-attachment`
- Price Foundation 侧：`exchange-rate / partner-price / price-policy / price-rule / price-list-version / promotion / tax-rate / pricing-engine / price-audit`

而 `prisma/seed.ts` 的 `SEED_ACTION_MODULES` 早已注册这些模块（DB permission catalog 有），`ALL_ACTION_PERMISSIONS = PERMISSION_MODULES.flatMap(...)` 因此**不含**这些 action → `ROLE_PERMISSIONS.SUPER_ADMIN/ADMIN` 静态授权缺失 → `requirePermission(user, "project-budget:create")` 返回 403。

**本质：static RBAC（shared constants）与 DB permission catalog / API contract 漂移**。constants 注释虽声明"必须与 prisma/seed.ts SEED_ACTION_MODULES 保持一致"，但无自动检查兜底，人工漏注册直到生产 smoke 才暴露。

## 决策

1. **规则（Accepted，长期生效）**：任何新增 `requirePermission("x:y")` 或 seed action module，都必须保证该权限可从 shared `PERMISSION_MODULES` 生成，即：

   ```
   API referenced permission ⊆ ALL_ACTION_PERMISSIONS
   ```

   允许的例外：`SYSTEM_PERMISSIONS` 显式列出的受限系统权限（如 `inventory-ledger:consume`）——这些是有意不开放给普通角色的系统级权限，但仍须在 constants 中显式声明。

2. **修复方式（PR #75，已完成）**：一次性补齐全部 17 个模块到 `PERMISSION_MODULES` 并同步 `PROJECT_MODULES`；未改 permission code、未改 `requirePermission()`、未改 seed 语义、未调整"权限检查优先于业务 Gate"的顺序。静态审计 308 个 API 引用权限码缺失归零；`dcefea3e` CI 三项全绿；Runtime Re-acceptance **31/31 PASS — ACCEPTED**。

3. **CI 静态 Gate（backlog，本轮不实现）**：评估把 `API referenced permission ⊆ ALL_ACTION_PERMISSIONS` 做成 CI 静态检查（扫描 `requirePermission("x:y")` 调用 + seed action module 列表 vs `PERMISSION_MODULES` 生成集合），避免未来再次等到生产 smoke 才发现 SUPER_ADMIN 403。**此项作为独立 Governance backlog 保留，不夹带进 Project Lifecycle 工作，不扩大本轮 scope。**

## 影响

- B2-2A / B2-2B：`project-budget / project-expense / project-progress` 权限恢复 → FINAL CLOSED ✅
- B2-1B regression：`project-product / project-tag` 潜伏 403 一并修复 → Product/Tag Add 201 ✅
- 未来新增模块：必须同步注册 shared constants，否则 CI/生产 smoke 会再次拦截

## 后续

- Governance Audit（独立 backlog）：评估 CI 静态 Gate 实现（扫描 `requirePermission` + `SEED_ACTION_MODULES` vs `PERMISSION_MODULES`）。
