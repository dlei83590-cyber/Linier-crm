# Sprint7 结算方式扩展 QA（ADR-0046）

- **日期：** 2026-08-20
- **范围：** PaymentMethod +3（银行/商业承兑汇票、电汇）+ 前端标签

| # | 检查项 | 结果 |
| --- | --- | --- |
| S1 | schema PaymentMethod +3（Migration 0039 ALTER TYPE ADD VALUE） | ✅ |
| S2 | zod receiptCreateSchema.paymentMethod +3 | ✅ |
| S3 | 前端 payments/receipts 4 页标签+选项 +3 | ✅ |
| S4 | GL 映射：新 3 项 → 1002 银行存款（CASH→1001 不变） | ✅ |
| S5 | 既有数据不受影响（ADD VALUE 仅追加） | ✅ |
