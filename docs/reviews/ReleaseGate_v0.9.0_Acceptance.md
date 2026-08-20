# ReleaseGate v0.9.0-alpha — Acceptance

- **日期：** 2026-08-20
- **作者：** CTO（AI Agent 代理执行）
- **发布基线：** main HEAD `7d3d8b7`（56 commits 于 v0.8.0-alpha 之后；CI run #548 全绿）
- **Tag：** `v0.9.0-alpha`（annotated tag；GitHub Pre-release，Release workflow 自动创建）

## Gate 检查项

| # | 检查项 | 证据 | 结果 |
| --- | --- | --- | --- |
| G1 | Quality Gates（lint / RBAC catalog gate / Prisma generate / type-check / unit tests） | run #548 quality job = success | ✅ |
| G2 | Build Gate（production build） | run #548 build job = success | ✅ |
| G3 | Secret Scanning | run #548 security job = success | ✅ |
| G4 | 单测覆盖（GL 过账/costing/SalesGL 不变量） | Sprint7_GL_QA / Costing_*_QA / Sprint7_SalesGL_QA + vitest | ✅ |
| G5 | Schema/Migration 一致（0001–0036 增量；0027 FROZEN；0028 FINAL） | prisma/migrations；本版 0031-0036 | ✅ |
| G6 | 文档同步（ADR-0033~0042 / EVENTS v1.40 / QA / test-cases / CHANGELOG / ROADMAP v1.26 / RELEASE_NOTES v0.9.0 段） | 各文件 git 记录 | ✅ |
| G7 | 生产迁移顺序与 seed 补充说明（1122/6001/22210102 科目） | docs/releases/v0.9.0-alpha.md Upgrade Guide | ✅ |
| G8 | 分支基线（远程仅 main + archive tags；无开放 PR） | gh branch/pr 核验 | ✅ |

## 已知限制（随本版发布声明，不阻塞 Release）

1. 销售侧 CN/DN 与坏账核销 GL 为 backlog（ADR-0042 后续）。
2. 增值税发票管理字段缺失（P1 中国缺口，独立 Design Gate）。
3. 会计期间表/凭证字/按月重排编号缺失（P1，独立 Gate）。
4. 应收应付期初余额 backlog。
5. Reservation / FIFO / 分仓成本 / BI / OA / Mobile HOLD。
6. main 分支保护未启用（治理建议，待 CTO 拍板）。

## 结论

**APPROVED — 达到 v0.9.0-alpha Release Candidate 条件**：CI 全绿、单测覆盖、Schema/Migration 一致、文档同步、发布工件齐备（docs/releases/v0.9.0-alpha.md 已就位，release.yml 可正常消费正文）。
