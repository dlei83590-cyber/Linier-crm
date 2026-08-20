# ADR-0046：中国结算方式扩展（银行/商业承兑汇票 + 电汇）

- 状态：**Accepted（Implemented，2026-08-20）**；Migration 0039
- 日期：2026-08-20
- 维护者：CTO（AI Agent 代理执行）｜审核：CTO
- 关联：CTO_Repo_Audit_2026-08-20（中国环境审计 **P1：PaymentMethod 无承兑汇票/电汇**）

---

## 背景

中国环境审计 P1：PaymentMethod 仅 BANK_TRANSFER/CHEQUE/CASH/CARD/OTHER，无银行/商业承兑汇票、电汇（T/T）——中国常用结算方式缺失。

## 决策

1. **枚举扩展**：`PaymentMethod + BANK_ACCEPTANCE_BILL（银行承兑汇票）/ COMMERCIAL_ACCEPTANCE_BILL（商业承兑汇票）/ TT_ELECTRONIC_TRANSFER（电汇）`；Migration 0039（ALTER TYPE ADD VALUE ×3，PG16 事务内允许）。
2. **API 同步**：receiptCreateSchema.paymentMethod zod enum +3。
3. **前端**：payments/receipts 四个页面（[id] 详情 + new 表单）标签与选项 +3（银行承兑汇票/商业承兑汇票/电汇）。
4. **GL 映射不变**：CASH→1001、其余（含新 3 项）→1002 银行存款。

## 边界

- 票据背书/贴现、承兑到期日跟踪、结算条款结构化（月结天数/预付比例）为 backlog。
