# Contract Evidence Archive — 合同证据归档

> 建立：2026-08-24（CTO Directive Phase 1，P0-2）｜ 性质：**Evidence 归档，非可编辑产品需求文档**
> 关联：docs/reviews/Contract_Feature_Coverage_Audit_2026-08-24.md（Phase 0 合同 20 项覆盖矩阵）

---

## 1. 归档原则（Evidence，不是需求文档）

- **合同原文是验收证据（Evidence），不是可随意编辑的产品需求文档。**
- 归档后的合同文件**禁止修改**；后续对合同条款的需求解释一律写入 ADR / Review 文档，不直接改历史合同证据。
- 每份合同文件必须记录：来源说明 / 合同版本与日期 / 验收功能清单定位 / 与审计矩阵的引用关系。

## 2. 归档清单

| 文件 | 来源 | 版本/日期 | 状态 |
|---|---|---|---|
| （待归档）原始合同文件 | CTO/业务方提供 | — | 待归档（见 §3） |

> 仓库当前**没有**合同原文文件（Phase 0 审计已标注该 Gap：审计基于 CTO Directive 转述的合同范围）。本索引先行建立归档结构与规则。

## 3. 待归档说明（P0-2 缺口如实记录）

- 合同原文（或仓库允许的不可变归档形式：扫描件/只读副本）需由 CTO/业务方提供后放入本目录。
- 归档时须补齐：来源说明、合同版本与日期、验收功能清单定位（对应审计矩阵 §9 的 20 项）、与 Contract_Feature_Coverage_Audit_2026-08-24.md 的引用关系。
- 在原文归档前，合同验收范围以 CTO Directive（2026-08-24）与审计矩阵为准。

## 4. 引用关系

- 功能覆盖：docs/reviews/Contract_Feature_Coverage_Audit_2026-08-24.md §9（20 项矩阵：合同条款 → Schema → API → UI → Permission → Audit/Event → Test → 状态 → Gap → PR）
- 治理基线：docs/ADR/ADR-0050-contract-alignment-gate.md（SSOT 冻结 / Phase 0-7 Gate / 冻结边界）
- 路线：docs/ROADMAP.md §1A（Contract Alignment Track）
