# Contract Evidence Archive — 合同证据归档

> 建立：2026-08-24（CTO Directive Phase 1，P0-2）｜ 性质：**Evidence 归档，非可编辑产品需求文档**
> 关联：docs/reviews/Contract_Feature_Coverage_Audit_2026-08-24.md（Phase 0 合同 20 项覆盖矩阵）

---

## 1. 归档原则（Evidence，不是需求文档）

- **合同原文是验收证据（Evidence），不是可随意编辑的产品需求文档。**
- 归档后的合同文件**禁止修改**；后续对合同条款的需求解释一律写入 ADR / Review 文档，不直接改历史合同证据。
- 每份合同文件必须记录：来源说明 / 合同版本与日期 / 验收功能清单定位 / 与审计矩阵的引用关系。

## 2. 归档清单（不可变 Evidence 索引）

| 字段 | 值 | 状态 |
|---|---|---|
| 合同原文文件 | （待 CTO/业务方提供：PDF 或批准的不可变替代形式） | PENDING |
| 来源说明 | 待填（提供方 / 获取渠道） | PENDING |
| 合同版本/日期 | 待填 | PENDING |
| 文件校验值（SHA-256） | 待归档时计算 | PENDING |
| 验收功能清单定位（页码） | 对应 Contract_Feature_Coverage_Audit §9 的 20 项 | PENDING |
| 关联审计文档 | docs/reviews/Contract_Feature_Coverage_Audit_2026-08-24.md | FINAL |

> **状态如实记录：Archive Structure FINAL / Original Evidence PENDING**（P0-2 = PARTIAL）。
> 合同原文 PDF 未入库——本目录已建立不可变归档结构与校验值字段模板，待 CTO/业务方提供合同原文后填入并锁定校验值（Evidence 不可变）。

## 3. 引用关系

- 功能覆盖：docs/reviews/Contract_Feature_Coverage_Audit_2026-08-24.md §9（20 项矩阵）
- 治理基线：docs/ADR/ADR-0050-contract-alignment-gate.md（SSOT 冻结 / Phase 0-7 Gate / 冻结边界）
- 遗留决策：docs/ADR/ADR-0051-customer-retirement-decision.md
- 路线：docs/ROADMAP.md §1A（Contract Alignment Track）
