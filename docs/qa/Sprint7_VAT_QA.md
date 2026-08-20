# Sprint7 VAT 发票管理 QA（ADR-0043）

- **日期：** 2026-08-20
- **范围：** 发票类型/税务号码/红字/开票资料/uscc 校验/9% 税率档（后端切片 + 前端接线 F1-F3：销售发票 VAT 详情/开票对话框、供应商发票 VAT 录入展示、往来单位开票资料编辑 Section；PR #98/#99/#101）
- **验证策略：** CI-First——单测由 CI Unit tests 验证；Migration 0037 由 CI Prisma generate + 部署核验

## 静态验收清单

| # | 检查项 | 结果 |
| --- | --- | --- |
| S1 | schema：InvoiceInvoiceType/InvoiceTaxpayerType 枚举 + TaxRateType.NINE | ✅ |
| S2 | Invoice/SupplierInvoice + 5 VAT 字段 + 自引用 FK + @@unique(taxInvoiceCode,taxInvoiceNo) | ✅ |
| S3 | InvoiceSnapshot + invoiceType/taxInvoiceCode/taxInvoiceNo（I9 快照还原） | ✅ |
| S4 | BusinessPartnerInvoiceInfo 表（partnerId 1:1 + uscc CHECK + approvalStatus） | ✅ |
| S5 | Migration 0037 DDL（枚举/表/列/CHECK/唯一/自引用 FK；ALTER TYPE ADD VALUE NINE 不落事务使用） | ✅ |
| S6 | errors.ts +10 码 + ERROR_CODES.md 自动重新生成（261 码） | ✅ |
| S7 | issue 路由：类型必填（I4）/号码格式（I7）/开票资料（I10）/红字（R2/R3/R4） | ✅ |
| S8 | 红字跳过 GL Outbox（负数与 GL_NEGATIVE_AMOUNT 冲突，backlog） | ✅ |
| S9 | business-partners PATCH taxInvoiceInfo upsert（uscc 校验） | ✅ |
| S10 | seed +CN_VAT_9（NINE 9.00） | ✅ |

## 不变量清单（单测覆盖）

| # | 不变量 | 单测 | 预期 |
| --- | --- | --- | --- |
| I1 | uscc GB 32100-2015（格式+校验码） | validateUscc 6 用例 | 合法通过/校验码错/字符集非法/长度边界拒绝 |
| I7 | 税务号码格式（12+8/数电20/EXPORT 可空/类型缺失） | validateTaxInvoiceFields 9 用例 | 按类型校验 |

## 已知限制

1. Design Gate §5 前端清单 F1-F3 已落地（PR #98/#99/#101）；**Known Risk：前端运行时需人工登录验证（无 E2E）**；红字开票选择器（前端 picker）仍为后续批次。
2. 红字发票 GL 记账为 backlog（负数金额与 postGlEntry 冲突，B3）。
3. 税控/数电直连、红字开票申请流程、发票类型→GL 科目映射为 backlog（B1-B13）。
4. 存量 BusinessPartner.invoiceInfo Json 保留兼容（B10 清理）。
