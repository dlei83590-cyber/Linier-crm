# SupplierCnDn_API.md — 测试用例（5C-2 Supplier CN/DN）

- 日期：2026-08-19｜关联：ADR-0030｜验证事实源 = GitHub CI + 生产 Runtime smoke

## 1. 认证与权限
| 用例 | 输入 | 期望 |
|---|---|---|
| AUTH-1 | 无 token | 401 |
| AUTH-2 | MANAGER（无 supplier-credit-debit-note:*） | 403 |
| AUTH-3 | SUPER_ADMIN | 200/201 |

## 2. 创建（POST /api/supplier-credit-debit-notes）
| 用例 | 输入 | 期望 |
|---|---|---|
| CDN-1 | noteType=CREDIT + 已 POSTED 发票 + 行 | 201；code=SCN-xxx；adjustmentTotal=Σ行（服务端） |
| CDN-2 | sourceInvoice 非 POSTED | 409 仅 POSTED 可生成 |
| CDN-3 | 行不属于该发票 | 400 LINE_NOT_IN_INVOICE |
| CDN-4 | 缺 reason/行 | 400 VALIDATION_ERROR |
| CDN-5 | DocumentSequence 缺失 | 500 fail closed（不生成临时编号） |
| CDN-15 | 跨票：sourceSupplierInvoiceIds=[invA, invB]（均 POSTED、同供应商同币种）+ 行归属两票 | 201；sourceSupplierInvoiceId=null；invoices 关联两票；adjustmentTotal=Σ行 |
| CDN-16 | 跨票：任一发票非 POSTED | 409 SOURCE_INVOICE_NOT_POSTED |
| CDN-17 | 跨票：发票不同供应商/不同币种 | 400 INVOICE_MISMATCH |
| CDN-18 | 跨票：行不属于任一关联发票 | 400 LINE_NOT_IN_INVOICE |
| CDN-19 | 跨票 PATCH 替换关联集合（DRAFT） | 200；invoices 整体替换 |
| CDN-20 | 旧单票字段 sourceSupplierInvoiceId（兼容） | 201；归一化为单元素关联集合 |

## 3. 状态机
| 用例 | 输入 | 期望 |
|---|---|---|
| CDN-6 | submit（DRAFT，version 正确） | 200 SUBMITTED；version+1 |
| CDN-7 | submit 非 DRAFT | 409 |
| CDN-8 | submit 过期 version | 409 VERSION_CONFLICT |
| CDN-9 | PATCH DRAFT only + CAS | 200；行整体替换 + 金额重算 |
| CDN-10 | apply（APPROVED，apply 人 ≠ 创建人） | 200 APPLIED；ApOpenItem.openAmount 更新 |
| CDN-11 | apply 重复 | 409 幂等拒绝 |
| CDN-12 | apply 非 APPROVED | 409 |
| CDN-13 | apply 人 = 创建人 | 409 MAKER_CHECKER |
| CDN-14 | CREDIT 超冲减（openAmount 将 <0） | 409 OVER_ADJUSTMENT |
| CDN-21 | 跨票 apply：金额按行归属分摊（invA 行 60 / invB 行 40） | 200；openAmountsAfter=[{invA, 440.0000},{invB, 260.0000}]（各自投影） |
| CDN-22 | 跨票 apply：仅一票 CREDIT 超冲减 | 409 OVER_ADJUSTMENT（整体拒绝，无部分应用） |
| CDN-23 | 跨票 apply：行归属发票不在关联集合 | 409 LINE_INVOICE_MISMATCH |
| CDN-24 | 跨票 apply：部分发票未过账（缺 Open Item） | 409 OPEN_ITEM_NOT_FOUND |

## 4. 事件与审计
| 用例 | 期望 |
|---|---|
| EVT-1 | apply 成功后 AuditLog 含 SupplierCreditDebitNoteApplied（载荷 code/noteType/adjustmentTotal/openAmountAfter；跨票含 sourceSupplierInvoiceIds[]/openAmountsAfter[]） |
| EVT-2 | DRAFT/SUBMITTED 仅 AuditLog（不发布领域事件） |