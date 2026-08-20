# ADR-0043：增值税发票管理字段（Sprint 7，CTO 拍板实现）

- 状态：**Accepted（Implemented，2026-08-20）**；Design Gate 见 docs/SPRINTS/Sprint7_VAT_Invoice_Design.md
- 日期：2026-08-20
- 维护者：CTO（AI Agent 代理执行）｜审核：CTO
- 关联：CTO_Repo_Audit_2026-08-20（中国环境审计 P1：增值税发票管理字段缺失 / P2：税率缺 9%）、Sprint7_SalesGL_Design（GL 边界）、Migration 0037

---

## 背景

中国环境审计 P1：全 schema 无发票类型（专票/普票/数电票）、无税务发票代码/号码、无红字发票实体；BusinessPartner.invoiceInfo 为自由 Json、uscc 无 18 位校验；TaxRateType 缺 9% 档。Design Gate（Sprint7_VAT_Invoice_Design.md）已批准，本 ADR 记录实现决策。

## 决策（实现 Gate）

1. **Schema + Migration 0037**：`InvoiceInvoiceType` 枚举（SPECIAL_VAT/ORDINARY_VAT/ELECTRONIC_VAT/EXPORT/OTHER）、`InvoiceTaxpayerType` 枚举（GENERAL_VAT_PAYER/SMALL_SCALE）、`TaxRateType + NINE`；Invoice/SupplierInvoice + invoiceType/taxInvoiceCode/taxInvoiceNo/redLetter/redInvoiceRefId（自引用 Restrict）+ `@@unique([taxInvoiceCode,taxInvoiceNo])`（I2，NULL 不参与）；InvoiceSnapshot + 3 列（I9）；新表 `BusinessPartnerInvoiceInfo`（partnerId 1:1，uscc DB CHECK 18 位格式，approvalStatus 审计）。
2. **号码校验（I7）**：专/普 12+8 全填（DB CHECK + 应用层 validateTaxInvoiceFields）；数电 20 位且 code 空；EXPORT/OTHER 可空；归一化（全角→半角/去空格/大写）。
3. **红字（R1-R4）**：`redInvoiceRefId 非空 ⇔ redLetter=true`（DB CHECK）；引用必须为 ISSUED 蓝票、禁链式（应用层）；金额服务端对原票取反（R3）；Σ|红字| ≤ |原票| 锁内累计校验（R4）；ISSUE 后全部冻结（I3，PATCH 字段不在 schema 内 + 路由守卫）。
4. **开票资料（I1/I10）**：BusinessPartnerInvoiceInfo 1:1 挂 Partner（Customer 复用 Partner，拒绝平行 CustomerInvoiceInfo）；uscc GB 32100-2015 校验码应用层校验（validateUscc）+ DB CHECK；taxpayerType 枚举；PATCH /api/business-partners/:id 支持 `taxInvoiceInfo` 结构化 upsert（变更 approvalStatus=DRAFT，maker-checker 由 BusinessPartner 审批投影治理）；开票 ISSUE 强制客户关联 Partner 且有 title+uscc 资料（fail-closed）。
5. **开票 ISSUE 集成**：invoiceIssueSchema + invoiceType（必填 I4）/taxInvoiceCode/No/redInvoiceRefId；ISSUED 快照固化 VAT 要素；InvoiceIssued Outbox 载荷扩展；**红字发票跳过 GL 过账**（负数金额与 postGlEntry GL_NEGATIVE_AMOUNT 冲突，红字 GL = backlog）。
6. **Seed**：+CN_VAT_9（NINE，9.00）。

## 边界（本 ADR 不做）

- 税控盘/数电票直连接口、红字开票申请流程（CN/DN → 红字自动联动）、发票类型→GL 科目映射、进项勾选认证、当日作废 VOID、开票限额、出口报关单号——均为 backlog（Design Gate §7 B1-B13）。
- 不改既有 5C/GRIR/AP/GL 过账逻辑与 vatRecoverable DB CHECK；不新增 API 端点与 docType；不改 DocumentSequence/Migration 0027/0028。
- 前端（开票表单类型联动/USCC 实时校验/详情红字链/主档开票资料 Tab）为后续批次。

## 影响

- Migration 0037（新枚举/新表/加列/CHECK/唯一索引/自引用 FK）；seed +9% 档；errors.ts +10 码（INVOICE_TYPE_REQUIRED/TAX_INVOICE_CODE_INVALID/TAX_INVOICE_NO_INVALID/USCC_INVALID/RED_INVOICE_REF_IMMUTABLE/RED_INVOICE_REF_STATUS_INVALID/RED_INVOICE_OVERFLOW/PARTNER_LINK_REQUIRED/PARTNER_INVOICE_INFO_MISSING/TAX_INVOICE_NO_DUPLICATE）；ERROR_CODES.md 自动重新生成（261 码，dogfood ②）；lib/tax-invoice.ts（validateUscc/validateTaxInvoiceFields/normalize*）+ 单测；issue 路由 VAT 校验 + 红字；business-partners PATCH 开票资料 upsert。
