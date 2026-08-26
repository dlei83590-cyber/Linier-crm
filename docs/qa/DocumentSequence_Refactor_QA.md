# 单据序列重构 QA（ADR-0055）

| # | 断言 | 结果 |
|---|------|------|
| S1 | schema 零变更：复用 ADR-0044 已有 `periodPattern`/`perPeriodReset`/`padLength` 字段，无新 Migration | ✅ |
| S2 | 共享引擎 `nextDocumentCode`：格式 `{prefix}-LNE{YYYY}{MM}{####}`（如 SO-LNE2026080001） | ✅ |
| S3 | 年份/月份由单据日期按 Asia/Shanghai 归属月（periodKeyOf）计算；跨月自动切期间行 | ✅ |
| S4 | 期间行 `code={docType}:{YYYYMM}` 按月独立计数，首张 0001 起，FOR UPDATE 原子无重复 | ✅ |
| S5 | 模板行缺失 fail closed（抛 DocumentSequenceMissingError，各 helper 映射回原错误码），禁 fallback 临时编号 | ✅ |
| S6 | JOURNAL 保持 ADR-0044 凭证字格式（记202608-0001），不套用 LNE | ✅ |
| S7 | 单号回收（recycle）：删除期间最后一张回退期间行 nextNo；历史旧格式单号不参与回收 | ✅ |
| S8 | seed：业务单据 padLength 4 + periodPattern + perPeriodReset；补 SCN/SDN；upsert update 传播新字段 | ✅ |

> 验证事实源 = GitHub CI（type-check / unit tests / build / lint）。运行时冒烟（真实建单取号）留待部署后人工执行。
