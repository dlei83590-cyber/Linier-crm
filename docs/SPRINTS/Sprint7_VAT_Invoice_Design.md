# Sprint 7 — 增值税发票管理字段（VAT Invoice Fields）Design / Scope Gate

- **日期：** 2026-08-20
- **作者：** CTO（AI Agent 代理执行）
- **状态：** DESIGN GATE —— 本文件仅交付设计，不落代码、不落库（Migration 0037 仅草案）
- **上游事实：**
  - `docs/reviews/CTO_Repo_Audit_2026-08-20.md`（中国环境审计 **P1：增值税发票管理字段缺失**、**P2：TaxRateType 缺 9%**；L42/L52/L88/L99：增值税发票管理 = P1 中国缺口，建议单独 Design Gate）
  - ROADMAP v1.26 L179：Supplier Invoice 已声明边界"区分 Supplier Invoice Fact / **中国增值税发票 Tax Invoice**"
  - `docs/SPRINTS/Sprint7_SalesGL_Design.md` L29：销售侧 GL Gate 明确"❌ 不做增值税发票管理字段（P1 中国缺口，**独立 Gate**）"
  - 仓库根 AGENTS.md §3：下一 Governance 项 = **增值税发票管理字段 / 会计期间体系 Design Gate**
- **范围：** 本 Gate 只做**发票类型 / 税务发票代码号码 / 红字引用实体 / 开票资料结构化 / USCC 校验 / 税率 9% 档**的字段与语义设计；**不做**税控盘/数电票直连接口、不做发票类型→GL 科目映射、不做红字与 CN/DN 的自动联动（全部标注为后续）。

---

## 1. 背景与问题定义（审计证据）

### 1.1 P1 证据（逐条 schema 行号）

| # | 审计发现 | Schema 证据 | 业务影响 |
| --- | --- | --- | --- |
| P1-1 | 全 schema 无发票类型（增值税专票/普票/数电票） | 全 schema grep 无 专票/普票/数电票/红字/taxInvoice/vatInvoice/redLetter；`Invoice` L3815-3865 仅内部 `code`；`SupplierInvoice` L5712-5759 仅 `invoiceNo`（内部 SINV 单号）+ `supplierInvoiceNo`（供应商业务号） | 销售/采购发票无法区分专票/普票 → 进项抵扣资格、报税统计、红字规则全部失真 |
| P1-2 | 无发票代码/发票号码（国标 12 位代码 + 8 位号码；数电票 20 位） | `Invoice.code` L3817 是内部单据编号（DocumentSequence，INV-2026-xxx），**不是**税务侧号码；无 `taxInvoiceCode` / `taxInvoiceNo` 字段 | 税务发票号码无登记锚点 → 税局查验、红字关联、发票影像归档无法落地 |
| P1-3 | 无红字发票实体 | 全 schema 无 `redLetter` / `redInvoiceRefId`；`InvoiceStatus` L3660 `CANCELLED` 仅限 DRAFT 撤销；已开票纠错只走 4E-3 CN/DN（`CreditDebitNote` L4339、`InvoiceAdjustment` L4423） | 已开票发票的**税务侧**红冲（负数发票）无法表达 |
| P1-4 | 开票资料为自由 Json | `BusinessPartner.invoiceInfo Json?` L532（自由 Json，无结构化约束）；`bankName` L533 / `bankAccount` L534 为通用结算字段 | 发票抬头/税号/开户行不可控 → 开票错误、跨单据不一致 |
| P1-5 | uscc 无 18 位格式校验 | `BusinessPartner.uscc String? @unique` L528（仅唯一，无 DB CHECK）；`Customer` L2480-2521 **无 uscc**，且 `partnerId` 可空（L2485） | 税号脏数据（位数/字符/校验码错误）→ 开票被税局拒收，且无报错点 |
| P1-6 | taxpayerType 为自由文本 | `BusinessPartner.taxpayerType String?` L529 | 无法用纳税人类型驱动规则（如开票限制、默认税率、数电票资质） |

### 1.2 P2 证据

| # | 审计发现 | Schema 证据 |
| --- | --- | --- |
| P2-1 | `TaxRateType` 缺 9% 税率档 | `TaxRateType` L76-82 仅 `ZERO / SIX / THIRTEEN / EXEMPT / CUSTOM`，**无 `NINE`**；中国增值税 9% 档适用交通运输/建筑/不动产租赁/农产品等 |

### 1.3 现有能力盘点（复用，不重复造）

| 能力 | 证据 | 本 Gate 的复用方式 |
| --- | --- | --- |
| 内部单据编号 | `DocumentSequence` L978-998（docType/prefix/nextNo/padLength）；`DocumentType` L164-195（30 种，`INVOICE` / `SUPPLIER_INVOICE` 已有） | 内部 `code` / `invoiceNo` 继续走 DocumentSequence；**税务发票号码与内部编号解耦**（税务号码来自税局，系统不生成） |
| 不可变发票事实 | `Invoice` 金额 `Decimal(18,4)`（L3830-3832）服务端聚合权威；`InvoiceSnapshot` L3935-3964（固化节点 CREATED/ISSUED/CANCELLED） | 税务要素（类型/代码/号码）同样**只允许在 ISSUE 时写入，之后冻结**；快照补税务要素，对齐 L3942"快照必须能 100% 还原" |
| 纠错体系 | `CANCELLED` 仅 DRAFT（L3660，无 VOID）；4E-3 CN/DN（L4339 `CreditDebitNote`、L4423 `InvoiceAdjustment`，有符号金额 CN<0/DN>0，L4440）；GL 期间重开红字冲销凭证（ADR-0037） | 红字发票是新的一类**税务事实**，与 CANCEL/CN-DN/GL 红字冲销明确分层（§3.3 边界表） |
| 供应商进项可抵扣 | `SupplierInvoice.vatRecoverable` L5781 + `nonRecoverableTaxAmount` L5782（DB CHECK ⑦，L5665-5666） | 进项发票类型与 vatRecoverable 语义衔接（§3.4）；本 Gate 不改既有 CHECK |
| maker-checker | `BusinessPartner.approvalStatus` L558；`TaxProfile.approvalStatus` L811 | 开票资料变更复用 BusinessPartner 审批投影（§3.5） |
| 多国/含税配置 | `TaxProfile` L797-822（country/region/taxIncluded/rateType/rate） | 9% 档 = TaxProfile 增 `NINE` + rate=9.00 seed（§4） |

---

## 2. Scope（本 Gate 做 / 不做）

### 2.1 做（In Scope）

1. **发票类型**：新增 `InvoiceInvoiceType` 枚举（SPECIAL_VAT / ORDINARY_VAT / ELECTRONIC_VAT / EXPORT / OTHER），`Invoice` 与 `SupplierInvoice` 两侧各加 `invoiceType`（§3.1）。
2. **税务发票代码/号码**：`Invoice.taxInvoiceCode` / `Invoice.taxInvoiceNo`、`SupplierInvoice.taxInvoiceCode` / `taxInvoiceNo`，含 12+8 / 数电 20 位校验草案（§3.2）。
3. **红字发票实体**：`redLetter` + `redInvoiceRefId`（自引用原票），销售/采购两侧（§3.3、§3.4）。
4. **开票资料结构化**：新增 `BusinessPartnerInvoiceInfo`（USCC 18 位 GB 32100 校验、taxpayerType 枚举、发票抬头、注册地址/电话、开户行/账号），并决策 Customer 侧接入方式（§3.5）。
5. **税率 9% 档**：`TaxRateType` 增 `NINE`，seed 增 9% TaxProfile（§3.1.3、§4）。
6. **快照补税务要素**：`InvoiceSnapshot` 增 `invoiceType / taxInvoiceCode / taxInvoiceNo`（§4）。
7. **Migration 0037 草案**：仅 DDL 摘要设计，**不落库**（§4）。

### 2.2 不做（Out of Scope → 后续，详见 §7）

- ❌ 税控盘 / 数电票平台直连接口（自动开票、作废、查验、红冲上传税局）——**后续独立 Gate**（标注为本 Gate 最大后续项）。
- ❌ 销售侧 CN/DN GL 记账（已在 Sprint7_SalesGL backlog；Sprint7_SalesGL_Design.md L28）。
- ❌ 发票类型 → GL 科目映射（22210102 销项税专/普是否分科目）。
- ❌ 红字开票申请流程（CN/DN → 红字发票自动联动）。
- ❌ 进项发票勾选认证 / 待认证进项税管理。
- ❌ 修改既有 `vatRecoverable` 逻辑与 DB CHECK（L5665-5666）、不改 5C/GRIR/AP/GL 过账逻辑。
- ❌ 不做跨表（Invoice vs SupplierInvoice）税务号码全局唯一强约束（应用层暂不强制，见 §7）。
- ❌ 不新增 API 端点、不新增 docType、不改 DocumentSequence（税务号码不占内部序列）。

---

## 3. 字段设计

### 3.1 `InvoiceInvoiceType` 枚举 + 默认值策略

```prisma
/// 增值税发票类型（中国市场；中国审计 P1-1）
enum InvoiceInvoiceType {
  SPECIAL_VAT    // 增值税专用发票（一般纳税人开具；购买方可抵扣进项）
  ORDINARY_VAT   // 增值税普通发票（购买方不可抵扣进项）
  ELECTRONIC_VAT // 数电票（全电发票；20 位号码，无 12 位代码）
  EXPORT         // 出口发票（零税率/免税场景）
  OTHER          // 其他（非增值税单据：内部凭证/形式凭证）
}
```

**默认值策略（决策）：**

| 项 | 决策 | 理由 |
| --- | --- | --- |
| Schema 默认值 | `invoiceType InvoiceInvoiceType?` **可空**，**不设 DB 默认值** | DRAFT 阶段允许未定；ISSUE（销售）/POSTED（采购）时**必填校验，缺失 fail-closed**（不变量 I4）——避免系统静默写入错误税务事实 |
| UI 默认选中 | **ORDINARY_VAT（增值税普通发票）** | 保守默认：不自动假定客户进项抵扣资格（专票 = 可抵扣凭证，开错需红冲，代价高）；中国制造 ERP 实务中普票为"无特殊要求"默认 |
| 显式选择 | SPECIAL_VAT 需用户显式选择（一般纳税人客户），表单提示"一般纳税人客户请选专票" | 专票要求完整开票资料（税号+开户行账号），显式选择倒逼资料完整（§3.5 fail-closed） |
| 可配置化（SHOULD） | seed 配置 `DEFAULT_INVOICE_TYPE`；未来按 `BusinessPartnerInvoiceInfo.taxpayerType` 预选（一般纳税人 → 默认专票） | 避免硬编码业务偏好；预选逻辑 = backlog（§7） |

**建议税率映射（SHOULD，非本 Gate 强制）：** SPECIAL_VAT / ORDINARY_VAT → 13% / 9% / 6% / 3% 档（`TaxProfile.rateType`）；EXPORT → `ZERO` / `EXEMPT`；OTHER → `CUSTOM`。实现 Gate 在 ISSUE 校验中检查 `invoiceType` 与所选 `taxProfileId` 档位一致性。

**数电票细分说明（MAY）：** 数电票亦分「数电专票 / 数电普票」，本枚举以 `ELECTRONIC_VAT` 单值承载"全电形态"；可抵扣语义在**采购侧**由既有 `vatRecoverable`（L5781）表达（用户按数电专/普确认），**销售侧**销项税不区分。专/普细分字段留待税控直连 Gate（§7）。

### 3.2 `Invoice.taxInvoiceCode` / `Invoice.taxInvoiceNo`（位数校验草案）

```prisma
// 追加到 model Invoice（L3815-3865 内，与内部 code 并列但语义解耦）
invoiceType     InvoiceInvoiceType? // 发票类型（§3.1；ISSUE 时必填）
taxInvoiceCode  String? // 税务发票代码：纸质/电子专普票 12 位；数电票为 NULL
taxInvoiceNo    String? // 税务发票号码：纸票 8 位；数电票 20 位
```

**位数校验草案（应用层 regex + DB CHECK 兜底）：**

| 发票类型 | taxInvoiceCode | taxInvoiceNo | 规则 |
| --- | --- | --- | --- |
| SPECIAL_VAT / ORDINARY_VAT（纸质或税务 UKey 电子票） | MUST `^[0-9]{12}$` | MUST `^[0-9]{8}$` | code 与 no **必须同时提供**（12+8 国标） |
| ELECTRONIC_VAT（数电票） | MUST 为 NULL | MUST `^[0-9]{20}$` | 20 位号码，无 12 位代码 |
| EXPORT / OTHER | MAY 为空 | MAY 为空 | 不强制税务号码（出口报关单号等后续） |
| NULL（DRAFT 未定） | MUST 为空 | MUST 为空 | 未开票不得有税务号码 |

- **归一化（MUST）：** 存储前去除空格/全角转半角/去连字符，再按上表校验；存储统一半角大写。
- **唯一性（MUST）：** `@@unique([taxInvoiceCode, taxInvoiceNo])`。PostgreSQL 组合唯一约束中 **NULL 不参与** → 未开票多行均为 NULL 合法，已开票号码全局（表内）唯一（不变量 I2）。
- **写入时机（MUST）：** ISSUE 动作时填写；ISSUED 后 `invoiceType / taxInvoiceCode / taxInvoiceNo` 全部**冻结**（更新返回 409，不变量 I3）。DRAFT→ISSUE 仍遵守 L3817"DRAFT 不占号"（内部 code 延后取号），税务号码与内部编号**各自独立**。

**DB CHECK 草案（§4 落库时实施）：**

```sql
ALTER TABLE "Invoice" ADD CONSTRAINT "ck_invoice_tax_no_format" CHECK (
  ("invoiceType" IN ('SPECIAL_VAT','ORDINARY_VAT')
     AND "taxInvoiceCode" IS NOT NULL AND "taxInvoiceNo" IS NOT NULL
     AND "taxInvoiceCode" ~ '^[0-9]{12}$' AND "taxInvoiceNo" ~ '^[0-9]{8}$')
  OR ("invoiceType" = 'ELECTRONIC_VAT'
     AND "taxInvoiceCode" IS NULL AND "taxInvoiceNo" ~ '^[0-9]{20}$')
  OR ("invoiceType" IS NULL AND "taxInvoiceCode" IS NULL AND "taxInvoiceNo" IS NULL)
);
```

### 3.3 红字发票语义（`redInvoiceRefId` + `redLetter`）

**核心纪律：** 遵循仓库"不可变会计事实 / 纠错追加新事实"原则——红字发票是**新增一张负数发票事实**，**绝不 UPDATE 原票**。

```prisma
// 追加到 model Invoice
redLetter       Boolean  @default(false) // 红字（负数）发票标志
redInvoiceRefId String?  // 引用被冲销的原蓝字发票（同表自引用）
redInvoiceRef   Invoice? @relation("InvoiceRedRef", fields: [redInvoiceRefId], references: [id], onDelete: Restrict)
```

**不变量（Blocking Gate，实现时 MUST 验证）：**

| # | 不变量 | 实现点 |
| --- | --- | --- |
| R1 | `redInvoiceRefId` 非空 ⇔ `redLetter = true`（DB CHECK） | ALTER TABLE CHECK |
| R2 | 被引用原票 MUST 为蓝字（`redLetter=false`）且状态为 ISSUED（销售）/ POSTED（采购）；**禁止引用 DRAFT/CANCELLED、禁止红字冲红字（链式引用）** | 应用层校验（引用指向终态蓝票） |
| R3 | 红字发票金额 = **服务端对原票金额取反**（subtotal/taxAmount/invoiceTotal 为负，仍 `Decimal(18,4)` 权威）；禁止客户端传正数再声明"红字" | ISSUE/POST 服务端计算 |
| R4 | 累计防超冲：Σ(同一 redInvoiceRefId 的红字 \|amount\|) ≤ 原票 \|amount\|（并发安全） | 锁序：collect ids → dedupe → sort → `SELECT ... FOR UPDATE`，与现有锁序纪律一致（AGENTS.md §3） |
| R5 | **引用不可变**：ISSUE（销售）/POSTED（采购）后 `redLetter / redInvoiceRefId / taxInvoiceCode / taxInvoiceNo / invoiceType` 全部冻结 | 状态机守卫（更新 409） |

**与现有机制的关系与边界（关键设计决策）：**

| 机制 | 适用时点 | 税务动作 | 财务/系统动作 | 本 Gate 定位 |
| --- | --- | --- | --- | --- |
| `CANCELLED`（L3660） | 仅 DRAFT 撤销 | 无 | 无（草稿作废） | 不变 |
| CN/DN（4E-3，L4339/L4423） | 已开票的 **AR/AP 业务调整** | **无**（业务调整单，非税票） | `InvoiceAdjustment` APPLIED 回写余额（有符号金额 CN<0/DN>0）；销售侧 CN/DN GL = backlog | 不变 |
| **红字发票（本 Gate 新增）** | 已 ISSUED/POSTED 的**税务纠错** | 负数税务发票（红冲），携带自身 `taxInvoiceNo` | 新增负数金额事实（GL 联动 = backlog）；可记录业务原因（reason 字段引用 CN/DN code） | **本 Gate 只建实体 + 引用关系** |
| GL 红字冲销凭证（ADR-0037 reopenPeriod） | GL 期间重开 | 无 | 借贷反向凭证 | 不变 |

> **边界结论：** 红字发票 ≠ CN/DN。CN/DN 是系统内余额调整事实，红字发票是税务侧负数凭证。本 Gate **不建立** CN → 红字发票的自动联动（红字开票申请流程 = backlog，§7）；两者通过 `remark`/业务原因人工关联，未来由红字开票申请单承载。

### 3.4 SupplierInvoice 侧对应字段

```prisma
// 追加到 model SupplierInvoice（L5712-5759）
invoiceType     InvoiceInvoiceType? // 进项发票类型（专票/普票/数电票）
taxInvoiceCode  String? // 税务发票代码（进项票 12 位；数电票 NULL）
taxInvoiceNo    String? // 税务发票号码（进项票 8 位；数电票 20 位）
redLetter       Boolean @default(false) // 供应商红字（负数进项票）
redInvoiceRefId String? // 自引用原蓝字 SupplierInvoice
redInvoiceRef   SupplierInvoice? @relation("SupplierInvoiceRedRef", fields: [redInvoiceRefId], references: [id], onDelete: Restrict)
```

- **三号区分（MUST 文档化）：** `invoiceNo`（内部 SINV 单号，L5714，DocumentSequence）≠ `supplierInvoiceNo`（供应商业务号，L5715，与 supplierId 组合唯一）≠ `taxInvoiceNo`（国家税务进项票号码，表内全局唯一）。三者互不替代。
- 校验/唯一/冻结规则与销售侧同构（§3.2、§3.3），采购侧冻结时点 = **POSTED**（对齐 5C-1 POSTED 终态证据，L5735-5737）。
- **与既有 `vatRecoverable`（L5781）衔接：** 建议映射（本 Gate 仅记录，**不改**既有 DB CHECK ⑦）：SPECIAL_VAT → `vatRecoverable=true`（进项可抵）；ORDINARY_VAT → `vatRecoverable=false`（不可抵）；ELECTRONIC_VAT → 按数电专/普用户确认。实现 Gate 可提供默认预填，自动判定留待 backlog（§7）。

### 3.5 开票资料结构化：`BusinessPartnerInvoiceInfo` + Customer 接入决策

```prisma
/// 纳税人类型（中国市场；替代 BusinessPartner.taxpayerType 自由文本 L529）
enum InvoiceTaxpayerType {
  GENERAL_VAT_PAYER // 一般纳税人
  SMALL_SCALE       // 小规模纳税人
}

/// 开票资料（税务发票要素；1:1 挂 BusinessPartner；中国审计 P1-4/P1-5）
model BusinessPartnerInvoiceInfo {
  id             String   @id @default(cuid())
  partnerId      String   @unique
  partner        BusinessPartner @relation(fields: [partnerId], references: [id], onDelete: Cascade)
  title          String   // 发票抬头（MUST = 营业执照企业全称）
  uscc           String   // 统一社会信用代码（MUST 18 位，GB 32100-2015）
  taxpayerType   InvoiceTaxpayerType @default(GENERAL_VAT_PAYER)
  registeredAddress String? // 注册地址（税务发票要素）
  registeredPhone  String? // 注册电话（税务发票要素）
  bankName         String? // 开户银行（税务发票要素；可与 PartnerBankAccount L2808 不同——开票账户 ≠ 收款账户）
  bankAccountNo    String? // 银行账号（税务发票要素）
  // 审计字段（对齐既有模式）
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  approvedById String?
  approvalStatus ApprovalStatus @default(DRAFT) // 变更走 maker-checker（复用 L558 投影）
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  @@index([partnerId])
}
```

**USCC 18 位校验（MUST，不变量 I1）：**

- 结构：18 位 = 登记管理部门代码（1）+ 机构类别代码（1）+ 登记管理机关行政区划码（6）+ 主体标识码（9）+ 校验码（1）。
- 字符集：`0-9` + `A-Z` **剔除 I/O/S/V/Z**（GB 32100-2015）；末位校验码允许 `X`。
- **DB CHECK（格式层）：** `uscc ~ '^[0-9A-HJ-NPQRTUWXY]{2}[0-9]{6}[0-9A-HJ-NPQRTUWXY]{9}[0-9X]$'`。
- **应用层（完整校验码，shared util `validateUscc`）：** 字符映射表 `'0123456789ABCDEFGHJKLMNPQRTUWXY'`（31 字符）+ 加权因子 `[1,3,9,27,19,26,16,17,20,29,25,13,8,24,10,30,28]`，模 31 计算校验码并与第 18 位比对；非法 **拒绝保存**（错误码 `USCC_INVALID`）。
- 存储规范化：去空格/全角转半角/统一大写（MUST）。

**Customer 侧接入方式（决策：复用 BusinessPartner，拒绝独立 CustomerInvoiceInfo）：**

| 方案 | 结论 | 理由 |
| --- | --- | --- |
| **复用 BusinessPartner（采用）** | ✅ | ① ROADMAP L68 设计意图："BusinessPartner 统一往来单位（客户/供应商/两者），含统一社会信用代码/纳税人类型/开票/银行/结算"；② `Supplier` 侧 `partnerId` 必填（L2860-2861），开票资料统一挂 BusinessPartner 进销两侧一套；③ 独立 `CustomerInvoiceInfo` 会与 `BusinessPartnerInvoiceInfo` 平行 = **平行业务真相**（违反 AGENTS.md"不创建平行业务真相"） |
| 独立 CustomerInvoiceInfo（拒绝） | ❌ | 双份真相、双份维护、与 ROADMAP 统一往来单位架构冲突；仅当 Customer 永不关联 Partner 时才有意义（与 L2485 可空设计冲突） |

**实施约束（fail-closed，不变量 I10）：**

- 销售 **ISSUE 开票 Gate（MUST）**：`customer.partnerId` 非空 **且** 该 Partner 存在 `BusinessPartnerInvoiceInfo`（`title` + `uscc` 必填），否则拒绝开票（错误码 `PARTNER_LINK_REQUIRED` / `PARTNER_INVOICE_INFO_MISSING`）。
- 存量无 Partner 的 Customer（L2485 可空）在首次开票前 MUST 先补关联并维护开票资料（主档操作，走既有 approvalStatus maker-checker）。
- 采购侧 Supplier 已强制挂 Partner（L2860-2861），`BusinessPartnerInvoiceInfo` 直接复用。

**与既有字段的关系（兼容策略）：** `BusinessPartner.taxpayerType`（L529 自由文本）与 `invoiceInfo`（L532 Json）**保留、标记 deprecated**（新录入走结构化模型）；存量数据回填 best-effort（§4），彻底清理 = backlog（§7）。

---

## 4. Migration 0037 草案（DDL 摘要，**仅草案，不落库**）

> 生产 baseline = Migration 0036（`0036_inventory_cost_balance`）；下一迁移号 = **0037**。以下为设计草案，实现 Gate 生成正式 SQL 并须过 CI。

**① 新枚举（Prisma enum → PG enum type）：**
- `CREATE TYPE "InvoiceInvoiceType" AS ENUM ('SPECIAL_VAT','ORDINARY_VAT','ELECTRONIC_VAT','EXPORT','OTHER');`
- `CREATE TYPE "InvoiceTaxpayerType" AS ENUM ('GENERAL_VAT_PAYER','SMALL_SCALE');`
- `ALTER TYPE "TaxRateType" ADD VALUE 'NINE';`
  - ⚠️ **实现注意：PG 的 `ALTER TYPE ... ADD VALUE` 不能在事务块内执行**（Prisma 迁移需按非事务迁移或拆步骤处理，实现 Gate 专项验证）。

**② 新表 `BusinessPartnerInvoiceInfo`：** 字段见 §3.5；`partnerId UNIQUE NOT NULL REFERENCES "BusinessPartner"(id) ON DELETE CASCADE`；`CHECK (uscc ~ '^[0-9A-HJ-NPQRTUWXY]{2}[0-9]{6}[0-9A-HJ-NPQRTUWXY]{9}[0-9X]$')`；审计字段齐备。

**③ `Invoice` 加列（L3815-3865）：**
```sql
ALTER TABLE "Invoice"
  ADD COLUMN "invoiceType" "InvoiceInvoiceType",
  ADD COLUMN "taxInvoiceCode" TEXT,
  ADD COLUMN "taxInvoiceNo" TEXT,
  ADD COLUMN "redLetter" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "redInvoiceRefId" TEXT;
ALTER TABLE "Invoice" ADD CONSTRAINT "ck_invoice_tax_no_format" CHECK (...); -- §3.2 草案
ALTER TABLE "Invoice" ADD CONSTRAINT "ck_invoice_red_ref" CHECK (
  ("redLetter" = true AND "redInvoiceRefId" IS NOT NULL)
  OR ("redLetter" = false AND "redInvoiceRefId" IS NULL));
ALTER TABLE "Invoice" ADD CONSTRAINT "fk_invoice_red_ref" FOREIGN KEY ("redInvoiceRefId")
  REFERENCES "Invoice"(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX "invoice_tax_no_unique" ON "Invoice"("taxInvoiceCode","taxInvoiceNo");
```

**④ `InvoiceSnapshot` 加列（L3935-3964）：** `"invoiceType" "InvoiceInvoiceType"`、`"taxInvoiceCode" TEXT`、`"taxInvoiceNo" TEXT` —— ISSUED 快照固化税务要素（对齐 L3942"快照 100% 还原"）。`sstNo`（L3945 遗留南洋概念）**保留不动**，清理 = backlog。

**⑤ `SupplierInvoice` 加列（L5712-5759）：** 同③（`invoiceType / taxInvoiceCode / taxInvoiceNo / redLetter / redInvoiceRefId`），CHECK 与唯一索引同构，自引用 FK。

**⑥ Seed（数据）：**
- 增 9% 档：`TaxProfile` 新行（如 code=`VAT_9`，name=`增值税 9%（交通运输/建筑/不动产租赁）`，country=`CN`，rateType=`NINE`，rate=`9.00`，approvalStatus=APPROVED）；既有默认 13% 档（THIRTEEN）不动（中国默认税率 13% 配置化纪律保持）。
- 回填 best-effort：`BusinessPartner.invoiceInfo`（Json，L532）可解析项 → `BusinessPartnerInvoiceInfo`；`taxpayerType`（L529）文本映射（"一般纳税人"→GENERAL_VAT_PAYER、"小规模"→SMALL_SCALE、其余→NULL）。回填失败不阻断，记录清单由 backlog 清理。

**⑦ 明确不落库：** 本 Gate 不执行 Migration、不修改 `prisma/schema.prisma`、不产生 `prisma/migrations/0037_*`。以上仅为实现 Gate 的 DDL 设计输入。

---

## 5. 前端影响（实现 Gate 的改动清单）

| 页面（现状路径） | 影响 |
| --- | --- |
| 销售发票列表 `apps/web/src/app/(dashboard)/sales/invoices/page.tsx` | 增发票类型徽标/筛选列；红字行红标显示 |
| 销售发票详情 `apps/web/src/app/(dashboard)/sales/invoices/[id]/page.tsx` | 详情展示发票类型、税控代码/号码（格式化 12-8 / 20 位）；红字链展示（原票 ↔ 红字互链跳转）；红字"负数"水印与金额红色展示 |
| 开票（issue）操作（Draft → Issue，销售发票页内） | 发票类型下拉（默认普票，提示"一般纳税人请选专票"）；按类型切换 12+8 / 20 位号码输入与实时校验；红字开票入口（选择原票 → 服务端取负金额 → 显示红字确认）；开票前校验 Partner 开票资料完整（缺资料引导去主档补录） |
| 供应商发票 `apps/web/src/app/(dashboard)/supplier-invoices/{new,[id],page}.tsx` | 进项发票类型/税控代码号码录入（new 页）、详情展示与红字引用（id 页）、类型筛选（列表页） |
| 客户/供应商主档（Master Data） | 开票资料区块/Tab：发票抬头、USCC（**实时 GB 32100 校验**，非法红字提示）、纳税人类型下拉、注册地址/电话、开户行/账号；复用既有 approvalStatus 审批流（maker-checker） |
| 校验文案 | 错误码文案映射（§6 错误码表）统一展示 |

- 无新增路由页面（主档 Tab 内嵌）；销售发票仍由 Delivery 派生（唯一入口 `POST /api/deliveries/{id}/invoice`，L3818），不新增入口。

---

## 6. 验收标准与不变量

### 6.1 不变量（Blocking Gate，实现时 MUST 全部满足）

| # | 不变量 | 实现点 |
| --- | --- | --- |
| I1 | **USCC 18 位校验**：格式（字符集/位数）+ GB 32100-2015 校验码算法；非法拒绝保存 | `validateUscc` shared util + DB CHECK + 主档表单实时校验 |
| I2 | **发票号码唯一性**：同表 `(taxInvoiceCode, taxInvoiceNo)` 组合唯一；NULL 不参与（未开票多行合法） | UNIQUE INDEX |
| I3 | **税务字段不可变**：ISSUE（销售）/POSTED（采购）后 `invoiceType / taxInvoiceCode / taxInvoiceNo / redLetter / redInvoiceRefId` 冻结（更新 409）；红字引用不可变 | 状态机守卫（CAS + 状态校验） |
| I4 | **发票类型 ISSUE 必填**：缺失 fail-closed 拒绝（错误码 `INVOICE_TYPE_REQUIRED`） | ISSUE/POST 校验 |
| I5 | **红字金额服务端取反**：subtotal/taxAmount/invoiceTotal 为负；禁客户端正数伪装；Σ\|红字\| ≤ 原票\|金额\|（锁内累计校验，锁序与现有纪律一致） | 服务端计算 + 锁序 |
| I6 | **红字引用一致性**：`redInvoiceRefId` 非空 ⇔ `redLetter=true`；原票为终态蓝票；禁链式红字 | DB CHECK + 应用校验 |
| I7 | **号码格式**：纸票 12+8 全填；数电票 20 位且 code 为空；EXPORT/OTHER 可空 | DB CHECK + regex |
| I8 | **金额/税率 Decimal 权威**：9% 档 `rate=9.00`（TaxProfile，可配置）；默认 13% 档不变 | TaxProfile seed |
| I9 | **快照可 100% 还原**：ISSUED 快照含 invoiceType/taxInvoiceCode/taxInvoiceNo | InvoiceSnapshot 加列 |
| I10 | **开票资料 maker-checker**：BusinessPartnerInvoiceInfo 变更走既有 approvalStatus 审批投影；开票时资料缺失 fail-closed | 复用 BusinessPartner 审批流 |
| I11 | **内部编号与税务号码解耦**：内部 code/invoiceNo 仍走 DocumentSequence；税务号码不占内部序列 | 不新增 docType |

### 6.2 实现 Gate 需注册的错误码（草案）

`INVOICE_TYPE_REQUIRED`、`TAX_INVOICE_CODE_INVALID`、`TAX_INVOICE_NO_INVALID`、`TAX_INVOICE_NO_DUPLICATE`、`USCC_INVALID`、`RED_INVOICE_REF_IMMUTABLE`、`RED_INVOICE_REF_STATUS_INVALID`、`RED_INVOICE_OVERFLOW`（累计超冲）、`PARTNER_LINK_REQUIRED`、`PARTNER_INVOICE_INFO_MISSING`。

### 6.3 验收清单（Definition of Done）

- [ ] Schema 草案评审通过（本文件作为 Design Gate 交付物）
- [ ] Migration 0037 草案进入实现 Gate（含 `ALTER TYPE ADD VALUE` 非事务处理方案）
- [ ] `validateUscc` 单测：合法 18 位通过、校验码错误拒绝、字符集非法拒绝、18 位长度边界
- [ ] 发票号码校验单测：12+8 / 20 位 / EXPORT 可空 / 数电 code 必空
- [ ] 红字：取反金额、防超冲（并发）、链式引用拒绝、冻结守卫
- [ ] 前端：开票表单类型联动校验、主档 USCC 实时校验、详情红字链
- [ ] 文档同步：ROADMAP、EVENTS（红字/发票事件）、ERROR_CODES、QA、test-cases、ADR-0043（草案）

---

## 7. 边界与 Backlog

| # | 项 | 说明 | 承接 |
| --- | --- | --- | --- |
| B1 | **税控盘/数电票直连接口**（自动开票、作废、查验、红冲上传税局、税控安全令牌） | 本 Gate 最大后续项；当前发票类型/号码仅手工登记 | 后续独立 Design Gate |
| B2 | 红字开票申请流程（CN/DN → 红字发票自动联动、审批） | 本 Gate 仅建实体与引用；R4 防超冲已为自动联动预留 | Backlog |
| B3 | 发票类型 → GL 科目映射（22210102 销项税专/普分科目；进项 222101 方向修正——审计 P2） | GL 科目已有 22210102（Sprint7_SalesGL）；映射策略待定 | Backlog |
| B4 | 销售侧 CN/DN GL 记账 | 已在 Sprint7_SalesGL backlog（Sprint7_SalesGL_Design.md L28） | Backlog |
| B5 | 进项发票勾选认证 / 待认证进项税 | 衔接 `vatRecoverable`（L5781） | Backlog |
| B6 | 进项发票类型自动判定 vatRecoverable（数电专/普细分） | 本 Gate 不改既有 DB CHECK ⑦（L5665-5666） | Backlog |
| B7 | 纸质票当日作废（VOID）语义 | 现状：DRAFT → CANCELLED（L3660）、ISSUED → 红字；当日作废特殊流程 | Backlog |
| B8 | 开票限额管理（万元版/十万版限量、领用） | 税控直连 Gate 一并设计 | Backlog |
| B9 | 出口发票版式 / 报关单号 | EXPORT 类型已建，细则后续 | Backlog |
| B10 | 存量清理：`sstNo`（L3945 遗留南洋概念）、`BusinessPartner.taxpayerType`（L529）、`invoiceInfo`（L532 Json） | 本 Gate 保留兼容（只读/回填），删除与迁移治理 | Backlog |
| B11 | 跨表税务号码全局唯一（Invoice vs SupplierInvoice） | 表内唯一已做（I2）；跨表强约束待税控直连后以税局为准 | Backlog |
| B12 | `DEFAULT_INVOICE_TYPE` 配置化 + 按 taxpayerType 预选 | §3.1 默认值策略的可配置化 | Backlog |
| B13 | 多币种 / 发票影像归档 / 快递邮寄跟踪 | 单币种 CNY 已定（ROADMAP v1.25）；影像走 File Center（businessType="invoice"，4D 已定） | Backlog |

**红线重申（实现 Gate MUST NOT）：** 不修改既有 5C/GRIR/AP/GL 过账逻辑与 `vatRecoverable` DB CHECK；不新增 API 端点与 docType；不修改 DocumentSequence；不改 Migration 0027/0028（FROZEN）；不触碰本地开发服务器（CI-First / No Local Server）。
