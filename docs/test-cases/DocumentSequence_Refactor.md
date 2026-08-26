# 单据序列重构 测试用例（ADR-0055）

## 引擎单元测试（apps/web/src/lib/document-sequence/next-code.test.ts 待补）

1. `nextDocumentCode` 首张单据返回 `{prefix}-LNE{YYYY}{MM}0001`（documentDate 为 2026-08 任意日）。
2. 同一期间连续取号递增（0001→0002→…）；跨月（documentDate=2026-09）切新期间行、从 0001 重新计数。
3. 模板行缺失抛 `DocumentSequenceMissingError`（fail closed）。
4. `renderPeriodPattern('LNE{YYYY}{MM}', date)` → `LNE202608`；`parsePeriodCode('SO-LNE2026080001')` → `{ periodKey:'202608', seqNo:1 }`；旧格式（SO000123）→ null。
5. `isCodeFree` 占用校验：返回 false 时继续递增（模拟软删记录占唯一键）。

## API 集成（部署后人工冒烟）

1. POST /api/quotations → code 形如 QT-LNE2026080001。
2. 建 PO/PR/REC/WHR/PRT/INV/SINV/收款/付款/盘点/调拨/转换/生产等，code 均符合 `{prefix}-LNE{YYYY}{MM}{####}`。
3. 跨月边界（月末/月初建单）期间正确归属。
4. 删除期间最后一张单据 → 重建复用该号（recycle 命中）。
