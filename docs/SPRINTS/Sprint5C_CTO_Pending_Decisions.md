# Sprint 5C：CTO Pending Decisions（待拍板决策清单 → 5C Design Review）

- 版本：v0.1（草案，P1-P12 待 CTO 拍板）
- 日期：2026-08-11
- 状态：**设计先行——禁止 Schema / Migration / API**（拍板完成前不写任何 5C 实现）
- 关联：Sprint5C_Supplier_Invoice_Three_Way_Match_AP_Gate.md / ADR-0027（草案）/ Sprint5C_Field_Matrix.md
- CTO 授权：#8777 Post-6B Portfolio Gate —— **Track B Sprint 5C START（后端最高优先级）**

> 说明：每项含推荐方案/备选方案/风险/CTO Recommendation——本轮不擅自 Final。P 编号沿用 6B 模式（P1-P12）。

---

## P1：SupplierInvoice 编号时机 —— 推荐：创建即取号（SINV）

**决策点**：DRAFT 不占号（对齐 4D Sales Invoice Issue 原子取号）vs 创建即取号（对齐 5A PO/5B GR/6B 全模块）。

**推荐方案**：**创建即取号（SINV DocumentSequence）**，缺失 fail closed 零 fallback（对齐 6B TRF/CNT/ADJ/CVT 模式）。
- 理由：采购侧单据一贯创建即取号（PO/GR/收据），发票录入是"供应商已开票"的事实记录，不是我方签发动作；取号延迟会造成单据编号不稳定（4D 取号延迟是因为 Invoice 是签发动作）。
- 备选：DRAFT 不占号（4D 模式）——若 CTO 认为发票=签发动作则选此。
- 风险：创建即取号会消耗编号（草稿废弃不回收）——采购侧可接受。

## P2：外币发票汇率 —— 推荐：行/头快照汇率（对齐 4D 快照税务汇率模式）

**决策点**：本币发票 vs 外币发票如何处理汇率。

**推荐方案**：`exchangeRate` 头级快照（录入时点冻结，服务端 Decimal），金额统一折本币聚合；汇率来源 = 系统汇率表（快照复制，不实时重算）。
- 风险：汇率时效性——快照即事实（对齐 4D Invoice 快照税务/汇率先例）。
- 备选：仅支持本币（首版收窄）——若 CTO 认为外币场景非首版。

## P3：SupplierInvoice 状态机 —— 推荐：DRAFT → SUBMITTED → MATCHED → APPROVED → POSTED / CANCELLED（含 VARIANCE 差异路径）

**决策点**：状态机如何表达三单匹配与过账。

**推荐方案**：
```
DRAFT → SUBMITTED → MATCHED → APPROVED → POSTED（生成 AP Open Item）/ CANCELLED
         │              │
         │              └─> VARIANCE → 差异处置（ACCEPT → APPROVED / REJECT / HOLD / CREATE_CN_DN）
         └──────────────> CANCELLED（POSTED 后禁取消——纠错走 Supplier CN/DN）
```
- **APPROVED ≠ POSTED**（POSTED 唯一生成 AP Liability 入口，终态证据 postedAt/postedById 非空）
- 差异路径：VARIANCE 不是终态，是中间态（挂起待处置）
- 风险：状态机复杂度——若 CTO 认为差异应在行级而非头级，改为行级 matchStatus + 头级聚合。

## P4：发票溯源模式 —— 推荐：RECEIPT_BASED 强制（首版收窄）

**决策点**：PO-only 直票（发票直接挂 PO，不需入库）vs RECEIPT_BASED（发票必须挂已入库事实）。

**推荐方案**：**RECEIPT_BASED 强制**（首版）——SupplierInvoiceLine 必须溯源 WarehouseReceiptLine（数量匹配基准），PO Line 仅作快照参考。
- 理由：三单匹配（PO/Receipt/Invoice）需要真实收货数量作为匹配基准；PO-only 直票会破坏"已收未票/暂估冲销"闭环（没有入库事实就没有暂估可冲）。
- 备选：双模式（PO_ONLY + RECEIPT_BASED）——若 CTO 认为存在"货未到先开票"的行业惯例（预付款/订金场景）。
- 风险：收窄可能挡掉预付/订金场景——若 CTO 要求，预付场景走独立 Prepayment/Deposit 模型（不混入 Supplier Invoice）。

## P5：匹配结果模型 —— 推荐：行级内嵌 matchStatus（不建独立 InvoiceMatch 表）

**决策点**：匹配结果随 Invoice 行内嵌 vs 独立 InvoiceMatch 模型。

**推荐方案**：**行级内嵌**（matchStatus + varianceQty/variancePrice/varianceTax 在 SupplierInvoiceLine 上）——匹配是行级校验事实，无独立生命周期。
- 备选：独立 InvoiceMatch 表（可追溯每次匹配快照）——若 CTO 认为需要匹配历史审计（每次重新匹配留痕）。
- 风险：内嵌模式每次匹配覆盖旧结果（不保留历史）——审计靠 AuditLog。

## P6：差异处置 —— 推荐：ACCEPT（审批放行）/ REJECT / HOLD / CREATE_CN_DN

**决策点**：数量/单价/税额差异如何处置。

**推荐方案**：
- **数量差异**：invoiceQty > 已收数量 → OVER_INVOICE（超过已收部分不可入 AP，挂起待收或供应商 CN）；invoiceQty < 已收数量 → UNDER_INVOICE（差异处置：接受差异或供应商 CN）
- **单价差异**：invoiceUnitPrice ≠ PO 快照 → 超容差走差异审批（Workflow，module=SUPPLIER_INVOICE）或 Supplier CN/DN；容差优先级对齐 5B 超收容差模式（PO Line → Supplier+Item → Item → Supplier → System 0%）
- **税额差异**：invoiceTax ≠ 服务端计算税 → 差异处置（税务快照/税率配置核对）
- 风险：差异审批条件复杂——首版建议阈值化（容差内直接 ACCEPT，超出走 Workflow）。

## P7：Supplier CN/DN 模型 —— 推荐：独立单据（signed adjustment，对齐 4E-3 模式方向相反）

**决策点**：独立 SupplierCN/DN 单据 vs 复用 SupplierInvoice 调整行。

**推荐方案**：**独立 SupplierCreditNote / SupplierDebitNote 单据**（SCN/SDN 序列），signed adjustment（CN<0 冲减 AP / DN>0 增加 AP）+ 累计防超调锁内重算（调整后 AP 余额不得为负）；状态机 DRAFT/SUBMITTED/APPROVED/APPLIED/CANCELLED，**APPROVED ≠ APPLIED**（Apply 唯一回写 AP 入口）。
- 理由：对齐 4E-3 CN/DN 治理先例（方向相反），独立模型可承载来源（发票差异/退货 CREDIT_ONLY）追溯。
- 备选：SupplierInvoice 负向行（简单但混淆"开票"与"调整"事实）。
- 风险：独立模型多一套序列/审批——但事实边界更清晰。

## P8：暂估应付触发 —— 推荐：WarehouseReceipt Posted 时自动暂估（GR/IR 投影）

**决策点**：自动暂估（入库即暂估）vs 月结批量暂估。

**推荐方案**：**自动暂估**——WarehouseReceipt Posted 时按 PO 快照单价 × 入库数量生成 GR/IR 暂估投影（不生成真实 AP Open Item）；到票冲暂估在 POSTED 时冲销。
- 备选：月结批量暂估（会计期末统一暂估）——若 CTO 认为逐单暂估噪音大。
- 风险：自动暂估产生大量投影——但"已收未票"是 5C 核心场景，逐单暂估可审计性更好。

## P9：进项税处理 —— 推荐：价税分离（不含税 AP + 税，税率快照）

**决策点**：含税 AP vs 价税分离。

**推荐方案**：**价税分离**——SupplierInvoiceLine 存 netAmount（不含税）+ taxRate（快照）+ taxAmount；AP Open Item 存含税总额（grossAmount），但净额/税额分开可审计（对齐中国增值税发票场景：进项税可抵扣）。
- 备选：含税单一金额（简单，但丢失进项税可抵扣信息）。
- 风险：价税分离增加行级计算复杂度——服务端 Decimal 聚合统一处理。

## P10：付款核销 —— 推荐：Payment 独立事实 + M:N Allocation（对齐 4E-2 方向相反）

**决策点**：付款如何核销 AP。

**推荐方案**：Payment（PAY 序列，DRAFT/SUBMITTED/APPROVED/APPLIED/CANCELLED）+ PaymentAllocationLine M:N 核销 AP Open Item；**Created ≠ Applied**（Apply 唯一回写 AP allocatedAmount）；**累计 allocation ≤ openAmount 锁内重算防超核销**；同供应商同币种。
- 备选：简单整单付款（无核销行）——若 CTO 认为首版不需要部分核销。
- 风险：M:N 核销复杂度高——但 AP 部分付款是常态（对齐 4E-2 先例）。

## P11：与 GL 的边界 —— 推荐：本阶段不建 GL，5C 只产出财务事实 + 事件

**决策点**：5C 是否做 GL 过账。

**推荐方案**：**不建 GL 总账**；5C 产出"财务事实"（AP Liability / GR/IR 暂估 / Supplier CN-DN / Payment Allocation），GL 过账留给未来 Finance 阶段消费（对齐 4E 不写 GL 先例——4E 产出 AR 事实，GL 后续）。
- 风险：财务侧可能期望 5C 直接过账——需明确"事实先行，过账后置"的边界。

## P12：maker-checker / 审批边界 —— 推荐：POSTED 与 APPLIED 高权限强审计；差异审批走 Workflow

**决策点**：谁可以过账发票（POSTED）、谁可以核销付款（Apply）。

**推荐方案**：**POSTED（过账）与 Payment Apply（核销）为受限权限**（SUPER_ADMIN/ADMIN，对齐 6B inventory-adjustment:apply 模式）；提交人 ≠ 过账人（maker-checker，DB CHECK + service 双保险，对齐 6B maker-checker）；差异审批走 Workflow（module=SUPPLIER_INVOICE，对齐 4E-3 条件审批模式）。
- 备选：普通审批流（全部走 Workflow）——若 CTO 认为发票过账必须全量审批。

---

> **注**：P1-P12 拍板后固化进 ADR-0027 / Gate / Field Matrix；**Schema/Migration 0027 仍需 CTO Gate 批准后创建**。
