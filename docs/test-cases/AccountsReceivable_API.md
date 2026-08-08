# Accounts Receivable API 测试用例（Sprint 4E-1 Accounts Receivable Foundation）

> 模块：Accounts Receivable Foundation（余额事实源查询，只读）
> 关联：docs/qa/Sprint4E1_QA.md、ADR-0020、Sprint4E1_AR_Design.md、API_GUIDELINES.md、ERROR_CODES.md、EVENTS.md v1.9
> 说明：覆盖 5 端点（全部只读）；重点覆盖 CTO Review 97/100 锁定项：无 POST/PATCH（AR 由 Invoice ISSUED 自动创建，金额禁止前端直改）、
> effectiveStatus 惰性投影（OVERDUE 不落库）、effectiveAgingBucket 动态计算（不存库）、Snapshot snapshotSource 来源枚举、
> 余额唯一口径 original+adjusted-paid-writeOff、Invoice 删除保护（Restrict）、Workflow 边界（AR 不审批）、Migration 0018 纯增量不动 Invoice。

## A. 认证与权限（Permission）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 | GET /api/accounts-receivables | 401 AUTHENTICATION_ERROR |
| A2 | 无 accounts-receivable:view | GET /api/accounts-receivables | 403 FORBIDDEN |
| A3 | 无 accounts-receivable:view | GET /api/accounts-receivables/:id | 403 |
| A4 | 无 accounts-receivable:view | GET /api/accounts-receivables/aging | 403 |
| A5 | 无 accounts-receivable-revision:view | GET /api/accounts-receivables/:id/revisions | 403 |
| A6 | 无 accounts-receivable-snapshot:view | GET /api/accounts-receivables/:id/snapshots | 403 |
| A7 | 权限码覆盖 3 模块 | accounts-receivable* / accounts-receivable-revision* / accounts-receivable-snapshot* | 无权限 403 |

## B. 端点存在性 / 边界（Endpoint / Boundary）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | 无 POST 端点 | POST /api/accounts-receivables | 404/405（AR 无独立创建入口——拍板①：Invoice ISSUED 自动创建） |
| B2 | 无 PATCH 端点 | PATCH /api/accounts-receivables/:id | 404/405（金额禁止前端直改——CTO 锁定） |
| B3 | 无 DELETE 端点 | DELETE /api/accounts-receivables/:id | 404/405（AR 是财务历史，禁止删除） |
| B4 | 列表空数据 | GET /api/accounts-receivables（无数据） | 200 空数组 + meta |
| B5 | 分页边界 | GET ?pageSize=500 | 钳制 100 |
| B6 | 分页默认 | GET（无参数） | page=1 pageSize=20 |
| B7 | 详情不存在 | GET /:id（无效 id） | 404 ACCOUNTS_RECEIVABLE_NOT_FOUND |
| B8 | 子资源不存在 | GET /:badId/revisions | 404 ACCOUNTS_RECEIVABLE_NOT_FOUND |
| B9 | 子资源不存在 | GET /:badId/snapshots | 404 ACCOUNTS_RECEIVABLE_NOT_FOUND |
| B10 | 软删除隔离 | deletedAt 记录 | 不出现在列表/详情 |

## C. 列表查询（List）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| C1 | 列表分页 | GET ?page&pageSize | 200 分页 meta（page/pageSize/total） |
| C2 | customerId 过滤 | GET ?customerId=xxx | 只返回该客户 AR |
| C3 | status 过滤 | GET ?status=OPEN | 数据库真实状态过滤 |
| C4 | status=PAID 过滤 | GET ?status=PAID | 只返回已收清 AR |
| C5 | status=OVERDUE 过滤（数据库层） | GET ?status=OVERDUE | 无结果（OVERDUE 不落库——拍板②） |
| C6 | effectiveStatus=OVERDUE 过滤 | GET ?effectiveStatus=OVERDUE | 返回 status∈{OPEN,PARTIALLY_PAID} 且 dueDate<now 的记录 |
| C7 | effectiveStatus=OPEN 过滤 | GET ?effectiveStatus=OPEN | 返回未逾期 OPEN（含 PAID 不匹配） |
| C8 | currency 过滤 | GET ?currency=CNY | 只返回 CNY 记录 |
| C9 | dueDateFrom 过滤 | GET ?dueDateFrom=2026-08-01 | dueDate >= 过滤值 |
| C10 | dueDateTo 过滤 | GET ?dueDateTo=2026-12-31 | dueDate <= 过滤值 |
| C11 | 组合过滤 | GET ?customerId&status&currency | 多条件 AND |
| C12 | 列表项摘要 | GET | 每项含 customer 摘要 + invoice 摘要（code/status/invoiceTotal） |
| C13 | 列表项惰性投影 | GET | 每项含 effectiveStatus/isOverdue/effectiveAgingBucket |
| C14 | 排序 | GET | createdAt desc |
| C15 | 金额字段 | GET | originalAmount/adjustedAmount/paidAmount/writeOffAmount/balanceAmount 为 Decimal 字符串 |

## D. 账龄分析（Aging）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| D1 | 账龄汇总 | GET /api/accounts-receivables/aging | 200，含 asOf/buckets/totalRecords/totalBalance |
| D2 | 桶结构 | GET /aging | buckets 含 0-30/31-60/61-90/90+/settled 五桶（count+balance） |
| D3 | 未逾期入 0-30 | dueDate > now 且 balance>0 | 归入 0-30 桶 |
| D4 | 逾期 ≤30 天 | dueDate 距今 1-30 天 | 归入 0-30 桶 |
| D5 | 逾期 31-60 天 | dueDate 距今 31-60 天 | 归入 31-60 桶 |
| D6 | 逾期 61-90 天 | dueDate 距今 61-90 天 | 归入 61-90 桶 |
| D7 | 逾期 90+ 天 | dueDate 距今 >90 天 | 归入 90+ 桶 |
| D8 | 已清余额 | balance=0 | 归入 settled 桶（不计账龄） |
| D9 | 无到期日 | dueDate=null 且 balance>0 | 归入 settled（无账龄可算） |
| D10 | 客户过滤 | GET /aging?customerId | 只统计该客户 |
| D11 | 币种过滤 | GET /aging?currency=CNY | 只统计该币种 |
| D12 | 合计一致性 | 各桶 balance 之和 + settled | ≈ totalBalance（未清+已清全量） |
| D13 | 空数据 | 无 AR | 全桶 0，totalRecords=0 |

## E. 详情（Detail）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| E1 | 详情一次带出 | GET /:id | AR + invoice 摘要 + customer 摘要 + 最近 revision + 最近 snapshot |
| E2 | 惰性投影 | GET /:id | 含 effectiveStatus/isOverdue/effectiveAgingBucket |
| E3 | 余额字段 | GET /:id | 四金额输入 + balanceAmount（Decimal 字符串） |
| E4 | 状态一致性 | GET /:id | status 为数据库真实状态（OPEN/PARTIALLY_PAID/PAID/CLOSED） |
| E5 | OVERDUE 详情 | 逾期记录 GET /:id | status=OPEN（库内）+ effectiveStatus=OVERDUE（投影）+ isOverdue=true |
| E6 | 关联 Invoice | GET /:id | invoice 含 code/status/invoiceDate/dueDate/invoiceTotal/paidAmount/balanceAmount |

## F. 子资源（Revisions / Snapshots）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| F1 | 修订列表 | GET /:id/revisions | 200，revisionNo desc |
| F2 | 修订快照数据 | GET /:id/revisions | snapshotData 金额为字符串（禁止 toNumber） |
| F3 | 快照列表 | GET /:id/snapshots | 200，generatedAt desc |
| F4 | 快照类型 | GET /:id/snapshots | snapshotType ∈ CREATED/PARTIALLY_PAID/PAID/ADJUSTED/WRITTEN_OFF/CLOSED |
| F5 | 快照来源枚举 | GET /:id/snapshots | snapshotSource ∈ ISSUE/PAYMENT/WRITE_OFF/ADJUSTMENT/MANUAL（必改②） |
| F6 | 快照金额字符串 | GET /:id/snapshots | snapshotData 金额为 Decimal 字符串 |
| F7 | 空历史 | 新 AR | revisions/snapshots 空数组 |

## G. 余额口径（Balance Formula）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| G1 | 初始余额 | original=1000 其余 0 | balanceAmount=1000（computeBalance 单入口） |
| G2 | 部分收款 | original=1000 paid=400 | balance=600 |
| G3 | 调整金额 | original=1000 adjusted=-100 | balance=900 |
| G4 | 核销 | original=1000 writeOff=200 | balance=800 |
| G5 | 全组合 | 1000+(-100)-400-200 | balance=300 |
| G6 | 收清 | paid=balance | balance=0（PAID 语义） |
| G7 | 精度 | 18,4 金额运算 | 无 Float 精度损失（Decimal/字符串） |
| G8 | 前端禁改 | 任何端点尝试提交金额 | 404/400（无 PATCH/无金额字段） |

## H. 红线核验（Red Line）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| H1 | 无 4E-2 实现 | 无 receipt/payment 端点 | 路由不存在（4E-2 后续） |
| H2 | 无 4E-3 实现 | 无 credit-note/debit-note 端点 | 路由不存在（4E-3 后续） |
| H3 | 无 WriteOff 表 | 代码审查 | 本阶段无 WriteOff 实体（拍板③：4E-2） |
| H4 | 无 Adjustment 表 | 代码审查 | 本阶段无 Adjustment 实体（拍板④：4E-3） |
| H5 | AR 无审批字段 | Schema 审查 | AR 模型无 workflowInstanceId/approvalStatus（必改④：AR 不审批） |
| H6 | 无 agingBucket 列 | Migration 审查 | AccountsReceivable 表无 agingBucket 列（必改①） |
| H7 | Invoice 删除保护 | Migration 审查 | AR.invoiceId FK onDelete: RESTRICT（必改③） |
| H8 | Migration 纯增量 | Migration 审查 | 只 CREATE TYPE/TABLE/INDEX/FK；无 DROP/RENAME/TRUNCATE/ALTER 旧表 |
| H9 | 不动 Invoice 表 | Migration 审查 | 0018 无任何 Invoice 表 ALTER（CTO 拍板） |
| H10 | Decimal 全程 | 代码审查 | 金额 Decimal(18,4)；投影计算 Number 仅展示不写库 |

> 合计：7（A）+ 10（B）+ 15（C）+ 13（D）+ 6（E）+ 7（F）+ 8（G）+ 10（H）= **76 用例**
