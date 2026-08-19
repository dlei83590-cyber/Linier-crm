# SupplierPayment_API.md — 测试用例（5C-2 Payment Allocation）

- 日期：2026-08-19｜关联：ADR-0030｜验证事实源 = GitHub CI + 生产 Runtime smoke

## 1. 认证与权限
| 用例 | 输入 | 期望 |
|---|---|---|
| AUTH-1 | 无 token | 401 |
| AUTH-2 | MANAGER | 403 |
| AUTH-3 | SUPER_ADMIN | 200/201 |

## 2. 创建（POST /api/supplier-payments）
| 用例 | 输入 | 期望 |
|---|---|---|
| PAY-1 | supplierId + amount + paymentDate + method | 201；code=PAY-xxx；allocated=0 / unallocated=amount；status=UNALLOCATED |
| PAY-2 | 供应商不存在 | 409 |
| PAY-3 | amount ≤ 0 / 缺必填 | 400 VALIDATION_ERROR |

## 3. 核销（POST /:id/apply）
| 用例 | 输入 | 期望 |
|---|---|---|
| PAY-4 | 核销 UNPAID Open Item（金额 ≤ 余额） | 200；allocation 创建；payment 投影/status 更新；openItem.openAmount 减少 |
| PAY-5 | 核销金额 > openAmount | 409 OVER_ALLOCATION |
| PAY-6 | 核销金额 > 未核销余额 | 409 OVER_PAYMENT |
| PAY-7 | 目标供应商/币种不一致 | 409 SUPPLIER_MISMATCH / CURRENCY_MISMATCH |
| PAY-8 | 核销人 = 创建人 | 409 MAKER_CHECKER |
| PAY-9 | 已全额核销后继续 | 409 FULLY_ALLOCATED |
| PAY-10 | 作废单核销 | 409 VOIDED |

## 4. 作废与反转
| 用例 | 输入 | 期望 |
|---|---|---|
| PAY-11 | void（UNALLOCATED） | 200 voidedAt 置位 |
| PAY-12 | void（已核销） | 409 HAS_ALLOCATION |
| PAY-13 | reverse allocation（纠错） | 200 reversedAt 留痕；payment/openItem 投影回滚 |
| PAY-14 | reverse 重复 | 409 ALREADY_REVERSED |

## 5. 事件与审计
| 用例 | 期望 |
|---|---|
| EVT-1 | apply 成功后 AuditLog 含 SupplierPaymentApplied（载荷 allocatedAmount/openAmountAfter/unallocatedAmountAfter） |