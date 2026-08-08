# DOMAIN_MODEL 领域模型

- 版本：v1.8
- 日期：2026-08-06
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：[PRODUCT_VISION.md](./PRODUCT_VISION.md) ｜ [ROADMAP.md](./ROADMAP.md) ｜ [ADR](./ADR/)

## 1. 业务主链（客户 → 项目 → 订单 → 交付 → 回款）

```
BusinessPartner（客户/供应商，统一往来单位）
        │
        ▼
Opportunity（项目机会：线索→准入→方案→报价）
        │  1:0..1
        ▼
Project（项目：试样→测试→小批量→批量供货→暂停/失败/结项）
        │  含 Stakeholder/Member/Milestone/Task/Budget/Expense/Product/Risk/Visit/Progress/Acceptance/Closure
        ▼
Quotation（报价单）──> Sales Order（销售订单）──> Contract（合同）
        │                                      │
        ▼                                      ▼
Delivery（发货 DO）                       Invoice（发票 CI）
        │                                      │
        ▼                                      ▼
Inventory（库存出库）                    Payment（收款核销）
                                                │
                                                ▼
                                              AR（应收）
```

## 2. 物料与供应链链（物料 → 价格 → 库存 → 采购/销售）

```
Item（物料：成品/原材料/配件/外购件/服务/包装物 + 工业字段）
  │
  ├── PriceList / PriceListItem（9 类价格：采购/销售/VIP/代理/工程/战略/区域/客户专属/历史）
  │
  └── Warehouse（仓库）──> Stock（库存余额）──> Batch（批次）
           │                    │
           ▼                    ▼
  Inventory Movement（出入库流水）──> Stock Count（盘点）/ Transfer（调拨）
           │
           ├── Purchase（采购：PR → PO → GRN → Supplier Invoice → Payment → AP）
           └── Sales（销售：Quotation → SO → Delivery → Invoice → Payment → AR）
```

## 3. 主数据关系

```
UnitOfMeasure ──< Item >── LinearGuideSpecification（1:1 扩展）
                    │
                    ├──< ItemStandard >── TechnicalStandard（GB/T 等）
                    │
                    └──< PriceListItem >── PriceList（priceType/含税体系）

BusinessPartner（uscc 唯一）──< ProjectOpportunity / Project

DocumentSequence（17 种单据类型，全局编号）
CommercialTerm（EXW/FOB/CIF/NET30）
```

## 4. 数据流（单据 → 财务）

```
Quotation ──> Sales Order ──> Delivery ──> Invoice ──> Payment ──> AR
                                                          │
Purchase Request ──> Purchase Order ──> GRN ──> Supplier Invoice ──> Payment ──> AP
                                                          │
Project Expense / 日常 Expense ──> 审批流 ──> Voucher（凭证）
                                                          │
                                              Journal ──> General Ledger ──> Profit / Cash Flow
```

## 5. 状态机（核心枚举）

| 对象 | 枚举 |
| --- | --- |
| 项目阶段 | LEAD → QUALIFIED → SOLUTION → QUOTATION → SAMPLING → TESTING → SMALL_BATCH → MASS_SUPPLY → PAUSED / FAILED / CLOSED |
| 关系人角色 | REQUESTER / TECHNICAL / PURCHASER / DECISION_MAKER / END_USER |
| 回款状态 | UNPAID / PARTIAL / PAID / OVERDUE |
| 里程碑 | PLANNED / IN_PROGRESS / COMPLETED / DELAYED |
| 任务 | TODO / IN_PROGRESS / DONE / CANCELLED |
| 风险 | OPEN / MITIGATING / CLOSED |
| 走访 | VISIT / PHONE / VIDEO / MEETING / OTHER |
| 验收 | PASSED / CONDITIONAL_PASS / FAILED / PENDING |
| 价格类型 | PURCHASE / SALES / VIP / AGENT / ENGINEERING / STRATEGIC / REGIONAL / CUSTOMER / HISTORICAL |
| 单据类型 | QUOTATION / SALES_ORDER / PURCHASE_ORDER / PROFORMA_INVOICE / COMMERCIAL_INVOICE / DELIVERY_ORDER / GOODS_RECEIPT_NOTE / GOODS_ISSUE / INVOICE / CREDIT_NOTE / DEBIT_NOTE / PAYMENT_VOUCHER / RECEIPT / EXPENSE / JOURNAL / CONTRACT / PROJECT |
| 报价状态（Sprint 4A） | DRAFT → SUBMITTED → APPROVED → SENT → ACCEPTED → CONVERTED；REJECTED（可编辑重提）；CANCELLED（DRAFT/SUBMITTED/APPROVED/SENT 可取消）；EXPIRED（惰性投影：SENT/APPROVED 且 validUntil < now，不落库） |
| 报价快照类型（Sprint 4A） | SUBMITTED / APPROVED / SENT / ACCEPTED / CONVERTED（仅固化节点生成，只读） |
| 报价修订状态（Sprint 4A） | DRAFT / SUBMITTED / APPROVED / SUPERSEDED（Revision 系统生成，不开放自由编辑） |

## 6. 已落地 vs 规划中

- ✅ 已落地（Sprint 2，PR #4）：Item / LinearGuideSpecification / BusinessPartner / PriceList / TechnicalStandard / UnitOfMeasure / CommercialTerm / DocumentSequence + 项目领域 14 模型
- ✅ 已落地（Sprint 3A，PR #5）：Workflow Foundation 22 模型（Workflow 6 + Approval 7 + Notification 4 + Dictionary 2 + Settings 3），见第 7-10 节
- 🔄 进行中（Sprint 3C）：Customer Foundation（第 16 节）✅ + Supplier/Item/Project/Price 后续子阶段
- ✅ 已落地（Sprint 4A，PR #12 验收中）：Quotation Foundation（Quotation/QuotationLine/QuotationRevision/QuotationSnapshot + ApprovalPolicy 复用），见第 19 节
- ✅ 已落地（Sprint 4B，PR #13 已合并）：Sales Order Foundation，见第 20 节
- ✅ 已落地（Sprint 4C，PR #14 已合并）：Delivery Foundation，见第 21 节
- ✅ 已落地（Sprint 4D，PR #15 已合并）：Invoice Foundation（Invoice/InvoiceLine/InvoiceRevision/InvoiceSnapshot + DeliveryLine 开票投影），见第 22 节
- ✅ 已落地（Sprint 4E-1，PR #16 已合并）：Accounts Receivable Foundation（AccountsReceivable/AccountsReceivableRevision/AccountsReceivableSnapshot + 1:1 Invoice），见第 23 节
- ⬜ 规划中（Sprint 4E-2~7）：Receipt/Payment（4E-2）/ Credit Note/Debit Note（4E-3）/ Purchase / GRN / Warehouse / Stock / AR 扩展 / AP / Voucher / Journal / GL

> 详细字段标准见数据库 schema（`prisma/schema.prisma`）与 [architecture/domain-model.md](./architecture/domain-model.md)。

## 7. Workflow Foundation（Sprint 3A）

### 7.1 模型关系

```mermaid
erDiagram
    WorkflowDefinition ||--o{ WorkflowStep : contains
    WorkflowStep ||--o{ WorkflowCondition : evaluates
    WorkflowDefinition ||--o{ WorkflowInstance : instantiates
    WorkflowInstance ||--o{ WorkflowAction : records
    WorkflowInstance ||--o{ WorkflowHistory : tracks
    WorkflowInstance ||--o{ Approver : assigns

    WorkflowDefinition {
        string id PK
        string code UK
        string name
        string module
        int version
        WorkflowStatus status
        bool isActive
        datetime deletedAt
    }

    WorkflowStep {
        string id PK
        string definitionId FK
        int stepNo
        string stepName
        ApproverType approverType
        string approverValue
        ApprovalMode approvalMode
        int timeoutHours
        bool allowReject
        bool allowTransfer
        bool allowDelegate
        bool allowWithdraw
        datetime deletedAt
    }

    WorkflowCondition {
        string id PK
        string stepId FK
        string expression
        string field
        ConditionOperator operator
        string value
        datetime deletedAt
    }

    WorkflowInstance {
        string id PK
        string definitionId FK
        string businessType
        string businessId
        WorkflowInstanceStatus status
        int currentStepNo
        string startedBy
        datetime startedAt
        datetime completedAt
        int version
        datetime deletedAt
    }

    WorkflowAction {
        string id PK
        string instanceId FK
        WorkflowActionType actionType
        string actorId
        string targetUserId
        int stepNo
        string comment
        datetime deletedAt
    }

    WorkflowHistory {
        string id PK
        string instanceId FK
        int stepNo
        WorkflowActionType actionType
        string beforeStatus
        string afterStatus
        string actorId
        string ip
        string device
        string browser
        string remark
        string attachment
        int duration
        datetime deletedAt
    }

    Approver {
        string id PK
        string instanceId FK
        int stepNo
        string userId
        ApproverStatus status
        string delegatedFrom
        datetime decidedAt
        string comment
        datetime deletedAt
    }
```

### 7.2 定义状态机（WorkflowStatus）

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> ACTIVE: publish（需至少一个步骤）
    ACTIVE --> ARCHIVED: archive
    ARCHIVED --> [*]
```

> 注意：已发布（ACTIVE）/归档（ARCHIVED）后禁止修改 code/module/steps，只能修改 name/description；更新必须携带 version（乐观锁）。

### 7.3 实例状态机（WorkflowInstanceStatus）

```mermaid
stateDiagram-v2
    [*] --> RUNNING: create（SUBMIT 动作记录）
    RUNNING --> RUNNING: approve(未到终步)/transfer/delegate/comment
    RUNNING --> COMPLETED: approve（最后一步）
    RUNNING --> REJECTED: reject / return（第一步退回=驳回）
    RUNNING --> TERMINATED: terminate
    RUNNING --> WITHDRAWN: withdraw（仅发起人）
    COMPLETED --> RUNNING: submit（重新提交）
    REJECTED --> RUNNING: submit（重新提交）
    TERMINATED --> RUNNING: submit（重新提交）
    WITHDRAWN --> RUNNING: submit（重新提交）
    COMPLETED --> [*]
    REJECTED --> [*]
    TERMINATED --> [*]
    WITHDRAWN --> [*]
```

> 审批人状态（ApproverStatus）：PENDING → APPROVED / REJECTED / DELEGATED / SKIPPED。

## 8. Approval Engine（Sprint 3A，与 Workflow 解耦）

```mermaid
erDiagram
    ApproverGroup ||--o{ ApproverGroupMember : contains
    WorkflowInstance ||--o{ ApprovalDelegate : delegates
    WorkflowInstance ||--o{ ApprovalEscalation : escalates
    WorkflowInstance ||--o{ ApprovalTimeout : times_out
    WorkflowInstance ||--o{ ApprovalReminder : reminds

    ApproverGroup {
        string id PK
        string code UK
        string name
        string description
        int version
        datetime deletedAt
    }

    ApproverGroupMember {
        string id PK
        string groupId FK
        string userId
        datetime deletedAt
    }

    ApprovalDelegate {
        string id PK
        string fromUserId
        string toUserId
        datetime validFrom
        datetime validTo
        bool isActive
        int version
        datetime deletedAt
    }

    ApprovalEscalation {
        string id PK
        string instanceId FK
        int stepNo
        int thresholdHours
        string escalateToUserId
        int version
        datetime deletedAt
    }

    ApprovalTimeout {
        string id PK
        string instanceId FK
        int stepNo
        int timeoutHours
        WorkflowActionType actionOnTimeout
        int version
        datetime deletedAt
    }

    ApprovalReminder {
        string id PK
        string instanceId FK
        int stepNo
        int intervalHours
        int maxTimes
        int version
        datetime deletedAt
    }
```

> Workflow 定义流程（Definition/Step/Condition）；Approval 执行审批（Approver/Group/Delegate/Escalation/Timeout/Reminder）。

## 9. Notification（Sprint 3A，统一事件中心）

```mermaid
erDiagram
    NotificationTemplate ||--o{ NotificationMessage : renders
    NotificationMessage ||--o{ NotificationLog : delivers

    NotificationTemplate {
        string id PK
        string code UK
        string name
        NotificationChannelType channel
        string subject
        string content
        int version
        datetime deletedAt
    }

    NotificationMessage {
        string id PK
        string templateId FK
        string recipientUserId
        NotificationChannelType channel
        string subject
        string content
        NotificationStatus status
        datetime sentAt
        datetime readAt
        string error
        int version
        datetime deletedAt
    }

    NotificationChannel {
        string id PK
        string code UK
        string name
        NotificationChannelType channelType
        Json config
        int version
        datetime deletedAt
    }

    NotificationLog {
        string id PK
        string messageId FK
        NotificationChannelType channel
        NotificationStatus status
        Json payload
        string error
        int version
        datetime deletedAt
    }
```

> 渠道（NotificationChannelType）：SYSTEM / EMAIL / TELEGRAM / WEBHOOK（本轮仅建模，不真实发送）+ WECHAT / DINGTALK（预留）。
> 状态（NotificationStatus）：PENDING / SENT / FAILED / READ。

## 10. Dictionary 与 Settings（Sprint 3A）

```mermaid
erDiagram
    DictionaryType ||--o{ DictionaryItem : contains

    DictionaryType {
        string id PK
        string code UK
        string name
        string category
        string language
        int sort
        string icon
        string color
        bool enabled
        int version
        datetime deletedAt
    }

    DictionaryItem {
        string id PK
        string typeId FK
        string code
        string label
        int sort
        string color
        string icon
        bool enabled
        int version
        datetime deletedAt
    }

    SystemSetting {
        string id PK
        string key UK
        string value
        SettingDataType dataType
        bool encrypted
        string description
        int version
        datetime deletedAt
    }

    TenantSetting {
        string id PK
        string tenantId
        string key
        string value
        SettingDataType dataType
        bool encrypted
        string description
        int version
        datetime deletedAt
    }

    UserSetting {
        string id PK
        string userId
        string key
        string value
        SettingDataType dataType
        bool encrypted
        string description
        int version
        datetime deletedAt
    }
```

> Settings 三层：SYSTEM 全局唯一 key；TENANT 按 tenantId+key；USER 按 userId+key。
> `encrypted=true` 时 API 返回掩码（******），不返回明文（见 ADR-0004）。
> 数据类型（SettingDataType）：STRING / NUMBER / BOOLEAN / JSON / SECRET。

## 11. 关系及删除策略（Sprint 3A，真实 Schema）

| 关系 | onDelete | 原因 |
| --- | --- | --- |
| WorkflowDefinition → WorkflowStep | Cascade | 步骤依附定义，删定义即删步骤 |
| WorkflowStep → WorkflowCondition | Cascade | 条件依附步骤 |
| WorkflowDefinition → WorkflowInstance | Restrict | 已产生实例的模板不可物理删除 |
| WorkflowInstance → WorkflowAction | Cascade | 动作随实例保留 |
| WorkflowInstance → WorkflowHistory | Cascade | 历史随实例保留 |
| WorkflowInstance → Approver | Cascade | 审批人随实例保留 |
| WorkflowInstance → ApprovalEscalation / Timeout / Reminder | Cascade | 规则随实例保留 |
| ApproverGroup → ApproverGroupMember | Cascade | 成员依附组 |
| NotificationTemplate → NotificationMessage | SetNull | 保留发送历史，模板删除后消息置空 |
| NotificationMessage → NotificationLog | SetNull | 保留发送日志 |
| DictionaryType → DictionaryItem | Cascade | 字典项依附类型 |

> 统一审计字段（CTO 规则）：id / createdAt / createdBy / updatedAt / updatedBy / version / approvalStatus / isDeleted / deletedAt / deletedBy；业务数据一律软删除，禁止物理删除。

## 12. Audit Center（Sprint 3B 升级，ADR-0005）

```mermaid
erDiagram
    User ||--o{ AuditLog : acts

    AuditLog {
        string id PK
        string actorId FK
        string action
        string entityType
        string entityId
        Json beforeData
        Json afterData
        string requestId
        string traceId
        Json meta
        string ipAddress
        string device
        string browser
        int duration
        AuditResult result
        datetime createdAt
    }
```

- 字段语义：entityType = ObjectType；entityId = ObjectId；beforeData/afterData = 操作前后数据快照；requestId/traceId = 链路追踪；device/browser = 终端环境（UA 解析）；duration = 耗时（毫秒）；result = SUCCESS/FAILURE/PARTIAL
- 枚举：AuditResult（SUCCESS / FAILURE / PARTIAL）
- 迁移 `0005_audit_upgrade`：仅 ALTER 加列 + 建索引（表已存在不重建，CTO 规则），新增 requestId/traceId/result 索引
- API：`GET /api/audit-logs`（分页 + actorId/entityType/entityId/action/result/requestId/traceId/时间过滤）+ `GET /api/audit-logs/:id`；权限 `audit:view`（仅 SUPER_ADMIN/ADMIN）
- requestMeta() 统一提取 IP/Device/Browser/RequestId/TraceId；所有写操作自动写入完整审计


## 13. Menu Center（Sprint 3B，ADR-0006）

```mermaid
erDiagram
    MenuGroup ||--o{ Menu : contains
    Menu ||--o{ Menu : tree

    MenuGroup {
        string id PK
        string code UK
        string name
        string icon
        int sort
        int version
        datetime deletedAt
    }

    Menu {
        string id PK
        string groupId FK
        string parentId FK
        string code UK
        string name
        string path
        string icon
        int sort
        bool hidden
        bool cache
        string externalLink
        string permission
        int version
        datetime deletedAt
    }
```

- RouteMeta 内联：path / icon / sort / hidden（隐藏）/ cache（缓存）/ externalLink（外链）/ permission（权限码）
- 删除策略：Menu → MenuGroup Cascade；Menu → Menu（parentId）SetNull（父删子提升为根）
- 迁移 `0006_menu_center`：2 表 + 索引 + 外键
- API：GET /api/menus（?tree=true 树形，前端直接读取）/ POST / GET / PATCH（乐观锁）/ DELETE（软删除，递归子树）
- 权限：menu / menu-group 模块，MANAGER 全量


## 14. Dashboard API（Sprint 3B，ADR-0007）

```mermaid
erDiagram
    DashboardWidget {
        string id PK
        string code UK
        string name
        DashboardWidgetType widgetType
        string dataSource
        Json query
        int refreshInterval
        int sort
        bool enabled
        int version
        datetime deletedAt
    }

    DashboardLayout {
        string id PK
        string code UK
        string name
        bool isDefault
        Json grid
        bool enabled
        int version
        datetime deletedAt
    }

    DashboardKpi {
        string id PK
        string code UK
        string name
        string unit
        DashboardAggregate aggregate
        string dataSource
        Json query
        Decimal target
        int sort
        bool enabled
        int version
        datetime deletedAt
    }

    DashboardChart {
        string id PK
        string code UK
        string name
        DashboardChartType chartType
        string dataSource
        Json query
        string xAxis
        string yAxis
        int sort
        bool enabled
        int version
        datetime deletedAt
    }
```

- 枚举：DashboardWidgetType（KPI/CHART/TABLE）、DashboardChartType（LINE/BAR/PIE/AREA/SCATTER）、DashboardAggregate（SUM/AVG/COUNT/MIN/MAX）
- 只提供数据 API（/api/dashboard/widgets|layouts|kpis|charts），页面 Sprint 8 开发
- 迁移 `0007_dashboard_api`：4 表 + 3 枚举 + code 唯一索引
- 权限：dashboard-widget / dashboard-layout / dashboard-kpi / dashboard-chart 模块，MANAGER 全量



## 15. File Center（Sprint 3B，ADR-0008）

```mermaid
erDiagram
    FileFolder ||--o{ FileFolder : tree
    FileFolder ||--o{ File : contains
    File ||--o{ FileVersion : versions
    File ||--o{ FileAttachment : attached

    FileFolder {
        string id PK
        string code UK
        string name
        string parentId FK
        int sort
        int version
        datetime deletedAt
    }

    File {
        string id PK
        string code UK
        string name
        string originalName
        string extension
        string mimeType
        int size
        string storagePath
        string checksum
        string folderId FK
        string ownerId
        int currentVersion
        int version
        datetime deletedAt
    }

    FileVersion {
        string id PK
        string fileId FK
        int versionNo
        string originalName
        string extension
        string mimeType
        int size
        string storagePath
        string checksum
        datetime deletedAt
    }

    FileAttachment {
        string id PK
        string fileId FK
        string businessType
        string businessId
        int sort
        datetime deletedAt
    }
```

- File 只存元数据（storagePath 指向对象存储/本地），真实二进制存储后续接入
- 创建 File 自动生成 versionNo=1；新版本推进 currentVersion（事务）
- 附件关联：fileId + businessType/businessId（quotation/contract/sales-order/invoice/project 统一引用）
- 预览：GET /api/files/:id/preview 按 mimeType 白名单判定可预览
- 删除策略：File → FileFolder SetNull；FileVersion/FileAttachment → File Cascade（逻辑软删）
- 迁移 `0008_file_center`：4 表 + 索引 + 外键
- 权限：file / file-folder / file-version / file-attachment 模块，MANAGER 全量



## 16. Customer Foundation（Sprint 3C-1，ADR-0009）

```mermaid
erDiagram
    BusinessPartner ||--o{ Customer : extends
    Industry ||--o{ Customer : classifies
    Customer ||--o{ CustomerContact : has
    Customer ||--o{ CustomerAddress : has
    Customer ||--o{ CustomerTag : tagged
    Tag ||--o{ CustomerTag : used_by
    Customer ||--o| CustomerCredit : credit

    Customer {
        string id PK
        string code UK
        string name
        string shortName
        string partnerId FK
        CustomerLevel level
        string industryId FK
        string region
        string sourceChannel
        string companySize
        datetime foundedDate
        string website
        int version
        datetime deletedAt
    }

    CustomerContact {
        string id PK
        string customerId FK
        string name
        string title
        string department
        string phone
        string email
        string wechat
        bool isPrimary
        int sort
        datetime deletedAt
    }

    CustomerAddress {
        string id PK
        string customerId FK
        CustomerAddressType addressType
        string recipient
        string phone
        string province
        string city
        string district
        string detail
        bool isDefault
        int sort
        datetime deletedAt
    }

    Tag {
        string id PK
        string code UK
        string name
        string color
        int sort
        bool enabled
        datetime deletedAt
    }

    CustomerTag {
        string id PK
        string customerId FK
        string tagId FK
        datetime deletedAt
    }

    Industry {
        string id PK
        string code UK
        string name
        int sort
        bool enabled
        datetime deletedAt
    }

    CustomerCredit {
        string id PK
        string customerId UK
        Decimal creditLimit
        Decimal usedCredit
        CustomerCreditRating rating
        CustomerCreditStatus status
        datetime reviewDate
        datetime deletedAt
    }
```

- 枚举：CustomerLevel（VIP/KEY/REGULAR/PROSPECT）、CustomerCreditRating（AAA~C）、CustomerCreditStatus（NORMAL/WATCH/FROZEN/CLOSED）、CustomerAddressType（REGISTERED/SHIPPING/INVOICING/CONTACT）
- 删除策略：Customer→Contact/Address/Credit/Tag Cascade（逻辑软删）；Customer→BusinessPartner/Industry SetNull
- 迁移 `0009_customer_foundation`：7 表 + 4 枚举 + 索引 + 外键
- API：customers 主档 CRUD + 子资源（contacts/addresses/tags/credit）+ industries/tags 字典 CRUD
- 权限：customer / customer-contact / customer-address / customer-tag / customer-credit / industry / tag 模块，MANAGER 全量
- seed：6 行业 + 4 标签（稳定 code + upsert）

## 17. Supplier Foundation（Sprint 3C-2，ADR-0010）

> 架构原则（CTO 最终模型）：**BusinessPartner 为唯一主体，Customer/Supplier 均为角色（BusinessPartnerRole），
> 联系人/地址/标签/银行/信用全部 Partner 级共享，绝不建两套**。
> Customer 3C-1 已交付子模型保留兼容，Sprint 5 统一迁移（ADR-0011）。

```mermaid
erDiagram
    BusinessPartner ||--o{ BusinessPartnerRole : has_role
    BusinessPartner ||--o{ PartnerContact : shared
    BusinessPartner ||--o{ PartnerAddress : shared
    BusinessPartner ||--o{ PartnerTag : shared
    Tag ||--o{ PartnerTag : used_by
    BusinessPartner ||--o{ PartnerBankAccount : shared
    BusinessPartner ||--o| PartnerCredit : shared
    BusinessPartner ||--o{ Supplier : extends
    Supplier ||--o{ SupplierQualification : has
    Supplier ||--o{ SupplierCertificate : has
    Supplier ||--o{ SupplierSettlement : has

    BusinessPartnerRole {
        string id PK
        string partnerId FK
        PartnerRoleType roleType
        bool isPrimary
        datetime deletedAt
    }

    PartnerContact {
        string id PK
        string partnerId FK
        string name
        string title
        string department
        string phone
        string email
        string wechat
        bool isPrimary
        int sort
        datetime deletedAt
    }

    PartnerAddress {
        string id PK
        string partnerId FK
        PartnerAddressType addressType
        string recipient
        string province
        string city
        string district
        string detail
        bool isDefault
        int sort
        datetime deletedAt
    }

    PartnerTag {
        string id PK
        string partnerId FK
        string tagId FK
        datetime deletedAt
    }

    PartnerBankAccount {
        string id PK
        string partnerId FK
        string bankName
        string accountName
        string accountNo
        string currency
        bool isDefault
        string swiftCode
        datetime deletedAt
    }

    PartnerCredit {
        string id PK
        string partnerId FK
        Decimal creditLimit
        Decimal usedCredit
        CustomerCreditRating rating
        CustomerCreditStatus status
        datetime reviewDate
        datetime deletedAt
    }

    Supplier {
        string id PK
        string code UK
        string name
        string partnerId FK
        SupplierStatus status
        int rating
        int defaultLeadTime
        Decimal minOrderQty
        string currency
        bool isPreferred
        datetime deletedAt
    }

    SupplierQualification {
        string id PK
        string supplierId FK
        QualificationType qualType
        string qualName
        string certNo
        datetime issueDate
        datetime expireDate
        string status
        string attachment
        datetime deletedAt
    }

    SupplierCertificate {
        string id PK
        string supplierId FK
        string certType
        string certName
        string certNo
        datetime issueDate
        datetime expireDate
        string attachment
        datetime deletedAt
    }

    SupplierSettlement {
        string id PK
        string supplierId FK
        string paymentTerms
        int creditDays
        string paymentMethod
        string currency
        datetime deletedAt
    }
```

- 枚举：PartnerRoleType（CUSTOMER/SUPPLIER/BOTH/LOGISTICS/OUTSOURCING）、SupplierStatus（POTENTIAL/QUALIFIED/PREFERRED/SUSPENDED/BLACKLISTED）、QualificationType（BUSINESS_LICENSE/ISO9001/ISO14001/IATF16949/CE/ROHS/OTHER）、PartnerAddressType（REGISTERED/BILLING/SHIPPING/WAREHOUSE/FACTORY/INVOICING/CONTACT）
- 删除策略：Supplier→Qualification/Certificate/Settlement Cascade（逻辑软删）；Supplier→BusinessPartner Restrict；Partner 共享子表→BusinessPartner Cascade（逻辑软删）
- 业务规则：Supplier.partnerId 必填唯一 + type=SUPPLIER/BOTH 校验；创建自动写入 BusinessPartnerRole(SUPPLIER)；联系人/地址/银行默认唯一；标签去重；信用 1:1 upsert
- 迁移 `0010_supplier_foundation`：10 表 + 4 枚举 + 索引 + 外键（仅新增不改既有）
- API：suppliers 主档 CRUD + 子资源（qualifications/certificates/settlements）+ Partner 共享视图（contacts/addresses/tags/bank-accounts/credit）+ business-partners roles
- 权限：supplier / supplier-qualification / supplier-certificate / supplier-settlement / business-partner-role / partner-contact / partner-address / partner-tag / partner-bank-account / partner-credit 模块，MANAGER 全量
- seed：SUP-0001/SUP-0002（关联 BP-S-0001/BP-B-0001）+ 3 条 PartnerRole（CUSTOMER/SUPPLIER/BOTH）

## 18. Item Master Foundation（Sprint 3C-3，ADR-0012）

> 定位（CTO #2075）：**Item Master 是 ERP 核心主数据**，Sales / Purchase / Inventory / Warehouse / BOM / Production / Cost / Finance 全部引用。
> 五级层级（正式定义）：Level1 Category → Level2 SubCategory → Level3 Series → Level4 Model → Level5 Variant；不设第六层，特殊规格进 ItemSpecification。

```mermaid
erDiagram
    ItemCategory ||--o{ ItemCategory : parent_sub
    ItemCategory ||--o{ Item : classifies
    Item ||--o{ ItemSpecification : has
    Item ||--o{ UomConversion : converts
    UnitOfMeasure ||--o{ Item : stock_uom
    UnitOfMeasure ||--o{ Item : purchase_uom
    UnitOfMeasure ||--o{ Item : sales_uom
    UnitOfMeasure ||--o{ UomConversion : from
    UnitOfMeasure ||--o{ UomConversion : to
    Item ||--o{ ItemCost : costs
    Item ||--o{ SupplierItem : sources
    BusinessPartner ||--o{ SupplierItem : supplies
    Item ||--o{ ItemRevision : versions
    Item ||--o{ ItemTag : tagged
    Tag ||--o{ ItemTag : used_by
    FileAttachment ||--o{ Item : attaches

    Item {
        string id PK
        string code UK
        string name
        ItemType itemType
        string categoryId FK
        string series
        string model
        string variant
        string oemCode
        string barcode
        string qrCode
        string drawingNo
        string revision
        ItemLifecycle lifecycle
        ItemStatus status
        string stockUomId FK
        string purchaseUomId FK
        string salesUomId FK
        bool isSalable
        bool isPurchasable
        bool isManufacturable
        int version
        datetime deletedAt
    }

    ItemCategory {
        string id PK
        string code UK
        string name
        string parentId FK
        int level
        int sort
        datetime deletedAt
    }

    ItemSpecification {
        string id PK
        string itemId FK
        string specKey
        string specValue
        string unit
        int sort
        datetime deletedAt
    }

    UomConversion {
        string id PK
        string itemId FK
        string fromUomId FK
        string toUomId FK
        Decimal factor
        datetime deletedAt
    }

    ItemCost {
        string id PK
        string itemId FK
        ItemCostType costType
        Decimal amount
        string currency
        datetime effectiveFrom
        datetime effectiveTo
        string source
        datetime deletedAt
    }

    SupplierItem {
        string id PK
        string itemId FK
        string supplierId FK
        string supplierCode
        Decimal moq
        int leadTime
        string currency
        Decimal purchasePrice
        bool isPreferred
        string incoterm
        string paymentTerm
        datetime deletedAt
    }

    ItemRevision {
        string id PK
        string itemId FK
        int revisionNo
        string revision
        string changeSummary
        string releasedById
        datetime releasedAt
        string status
        datetime deletedAt
    }

    ItemTag {
        string id PK
        string itemId FK
        string tagId FK
        datetime deletedAt
    }
```

- 枚举：ItemType（FINISHED_GOOD/RAW_MATERIAL/SEMI_FINISHED/PURCHASED_PART/ACCESSORY/SERVICE/CONSUMABLE/ASSET/TOOLING/PACKAGING）、ItemStatus（ACTIVE/INACTIVE/LOCKED/ARCHIVED）、ItemCostType（STANDARD/LAST_PURCHASE/AVERAGE/CURRENT）、AttachmentType（DRAWING/CERTIFICATE/PHOTO/MANUAL/MODEL_3D/VIDEO/INSPECTION_REPORT，统一放 File Center）；ItemLifecycle 重命名五值（DESIGN/TRIAL/MASS_PRODUCTION/DISCONTINUED/OBSOLETE）
- 业务规则：不建 Item.supplierId 单值字段，建 SupplierItem（一个 Item 多供应商）；ItemCost 只建接口不写算法；Lifecycle 与 Status 分离；附件复用 File Center（businessType=item + attachmentType）
- 迁移 `0011_item_foundation`：Item 表 ALTER（RENAME COLUMN category→itemType + ADD COLUMN，不改既有列）+ 7 新表 + 枚举演进 + FileAttachment.attachmentType（仅新增/加列）
- API：items 主档 CRUD + 分类树 + specifications/uom-conversions/costs/supplier-items/revisions/tags/attachments 子资源
- 权限：item（动作级）+ item-category/item-specification/item-uom/item-cost/item-supplier/item-revision/item-tag/item-attachment 模块，MANAGER 全量
- seed：SEED_LINEAR_GUIDE_ITEMS 同步（itemType/lifecycle 新枚举）

## 19. Quotation Foundation（Sprint 4A，ADR-0015/0016）

> 定位（CTO 审核锁定）：**Quotation 是 Sales 主链起点**（Quotation → Sales Order → Delivery → Invoice → Payment，ADR-0016 主链）。
> 价格红线（ADR-0015）：行价必须来自 `PricingEngine.resolvePrice() → QuotationPriceSnapshot → QuotationLine.priceSnapshotId`，禁止前端直接决定 unitPrice。
> 审批以 Workflow 为唯一事实源（ADR-0016 决策①）：不建 QuotationApproval 表，Quotation 仅保存投影（workflowInstanceId / approvalStatus / approvedAt / approvedById）。
> EXPIRED 惰性判定（决策②）：不落库、不增调度器，仅投影 effectiveStatus。

```mermaid
erDiagram
    Customer ||--o{ Quotation : issues
    ProjectOpportunity ||--o{ Quotation : converts_to
    Project ||--o{ Quotation : quotes
    WorkflowInstance ||--o{ Quotation : approves
    Quotation ||--o{ QuotationLine : contains
    Item ||--o{ QuotationLine : references
    QuotationPriceSnapshot ||--o{ QuotationLine : prices
    UnitOfMeasure ||--o{ QuotationLine : measures
    Quotation ||--o{ QuotationRevision : versions
    Quotation ||--o{ QuotationSnapshot : snapshots

    Quotation {
        string id PK
        string code UK
        string customerId FK
        string opportunityId FK
        string projectId FK
        QuotationStatus status
        datetime quoteDate
        datetime validFrom
        datetime validUntil
        string currency
        Decimal exchangeRateSnapshot
        string taxProfileId
        Decimal taxSnapshot
        Decimal subtotal
        Decimal discountRate
        Decimal taxAmount
        Decimal totalAmount
        string workflowInstanceId FK
        datetime approvedAt
        datetime convertedAt
        string salesOrderId
        ApprovalStatus approvalStatus
        int version
        datetime deletedAt
    }

    QuotationLine {
        string id PK
        string quotationId FK
        int lineNo
        string itemId FK
        string priceSnapshotId FK
        string description
        Decimal quantity
        string uomId FK
        Decimal unitPrice
        Decimal lineAmount
        Decimal taxAmount
        Decimal totalAmount
        int version
        datetime deletedAt
    }

    QuotationRevision {
        string id PK
        string quotationId FK
        int revisionNo
        QuotationRevisionStatus revisionStatus
        string changeReason
        Json snapshotData
        datetime deletedAt
    }

    QuotationSnapshot {
        string id PK
        string quotationId FK
        QuotationSnapshotType snapshotType
        int revisionNo
        Json snapshotData
        string generatedById
        datetime generatedAt
        datetime deletedAt
    }
```

### 关系与约束（真实 Schema）

| 关系 | 基数 | onDelete | 说明 |
| --- | --- | --- | --- |
| Customer → Quotation | 1:N | Restrict | 有报价的客户不可物理删 |
| ProjectOpportunity → Quotation | 1:N | SetNull | 机会删除不影响报价 |
| Project → Quotation | 1:N | Restrict | 有报价的项目不可物理删 |
| WorkflowInstance → Quotation | 1:N | SetNull | 审批实例删除不影响报价投影 |
| Quotation → QuotationLine | 1:N | Cascade | 行随单据软删 |
| Item → QuotationLine | 1:N | Restrict | 物料可空（允许非物料行） |
| QuotationPriceSnapshot → QuotationLine | 1:N | SetNull | 价格快照（ADR-0015，与 ProjectProduct 同构） |
| Quotation → QuotationRevision | 1:N | Cascade | 修订历史随单据 |
| Quotation → QuotationSnapshot | 1:N | Cascade | 快照随单据 |

- `Quotation.code` 唯一；`QuotationLine @@unique([quotationId, lineNo])`（行号 10/20/30 步进，插 25 不重排）；`QuotationRevision @@unique([quotationId, revisionNo])`；`QuotationSnapshot @@unique([quotationId, snapshotType])`
- 统一审计字段：isActive / createdById / updatedById / approvedById / approvalStatus / version / deletedAt / createdAt / updatedAt（全模型同构）
- 索引：code / customerId / status / opportunityId / projectId / workflowInstanceId / deletedAt；行：quotationId / itemId / priceSnapshotId / deletedAt

### 状态机与业务规则（Sprint 4A）

- **状态流转**：DRAFT → SUBMITTED → APPROVED → SENT → ACCEPTED → CONVERTED；REJECTED（可编辑后重新提交）；CANCELLED（DRAFT/SUBMITTED/APPROVED/SENT 可取消，ACCEPTED/CONVERTED 禁止）；EXPIRED（惰性投影：SENT/APPROVED 且 validUntil < now，不落库）
- **Action API 锁定**：submit / accept / cancel / convert 全部独立端点，不 PATCH status（ADR-0016 §8）
- **Revision 系统生成**：每次影响商业内容的修改（头字段/行增删改）自动创建 revisionNo+1，不开放自由编辑
- **Snapshot 固化节点**：SUBMITTED / APPROVED / SENT / ACCEPTED / CONVERTED 仅系统生成，只读
- **乐观锁**：头/行 PATCH 必带 version，冲突返回 409 VERSION_CONFLICT
- **软删除**：DELETE 置 deletedAt + isActive=false，级联软删 lines/revisions/snapshots；列表/详情过滤 deletedAt=null
- **审计**：全部写操作写 AuditLog；领域事件（EVENTS.md v1.2 注册 11 个，已发布 7 个）当前以 AuditLog 留痕（事件总线未落地）

### 交付（Sprint 4A）

- 迁移 `0014_quotation_foundation`：+4 模型（Quotation/QuotationLine/QuotationRevision/QuotationSnapshot，QuotationPriceSnapshot 为 3C-4 既有）+ 3 枚举（QuotationStatus/QuotationSnapshotType/QuotationRevisionStatus）；仅 CREATE/ALTER/INDEX/FK，无 DROP
- API：12 路由文件 / 18 端点（主档 CRUD + lines + revisions + snapshots + submit/accept/cancel/convert）
- 权限：13 权限码（quotation* / quotation-line* / quotation-revision* / quotation-snapshot*）
- 集成：submit → ApprovalPolicy 匹配 → WorkflowInstance（复用 Sprint 3A Workflow Engine）；审批终态回写 syncQuotationApproval（COMPLETED → APPROVED，REJECTED → REJECTED）
- 预留：convert 返回 501（Sprint 4B Sales Order Foundation 落地）；SENT 状态为下游预留，4A 无独立发送 API

## 20. Sales Order Foundation（Sprint 4B，ADR-0017）

> 定位（CTO 审核锁定）：**SalesOrder 是 Sales 主链第二环**（Quotation → Sales Order → Delivery → Invoice → Payment）。
> 唯一创建入口：`POST /api/quotations/{id}/convert`（Quotation ACCEPTED 后转单）；**不开放 `POST /api/sales-orders`**（Direct SO 禁止，ADR-0017 决策①）。
> 价格红线（ADR-0015/0017）：SO 继承 Quotation 商业价格，schema 无 unitPrice 字段；仅当数量/UOM 商业条件变更时重新走 PricingEngine 生成新快照。
> 审批复用 Workflow（不建 SalesOrderApproval 表）：workflowInstanceId/approvalStatus/approvedAt 为投影，条件触发（商业字段变更）。
> 交付投影（Sprint 4C 联动）：SalesOrderLine.deliveredQty/remainingQty + SalesOrder.status（PARTIALLY_DELIVERED/DELIVERED）由 Delivery 聚合回写，禁止手工 PATCH。

```mermaid
erDiagram
    Quotation ||--|| SalesOrder : converted_from
    Customer ||--o{ SalesOrder : places
    Project ||--o{ SalesOrder : relates
    WorkflowInstance ||--o{ SalesOrder : approves
    SalesOrder ||--o{ SalesOrderLine : contains
    Item ||--o{ SalesOrderLine : references
    QuotationPriceSnapshot ||--o{ SalesOrderLine : prices
    UnitOfMeasure ||--o{ SalesOrderLine : measures
    SalesOrder ||--o{ SalesOrderRevision : versions
    SalesOrder ||--o{ SalesOrderSnapshot : snapshots
    SalesOrder ||--o{ Delivery : fulfilled_by
    DeliveryLine ||--o{ SalesOrderLine : traces_to

    SalesOrder {
        string id PK
        string code UK
        string quotationId FK UK
        string customerId FK
        string projectId FK
        SalesOrderStatus status
        string currency
        Decimal subtotal
        Decimal taxAmount
        Decimal totalAmount
        string workflowInstanceId FK
        datetime approvedAt
        datetime deliveredAt
        int version
        datetime deletedAt
    }

    SalesOrderLine {
        string id PK
        string salesOrderId FK
        string sourceQuotationLineId FK
        int lineNo
        string itemId FK
        string priceSnapshotId FK
        Decimal quantity
        Decimal unitPrice
        Decimal lineAmount
        Decimal taxAmount
        Decimal totalAmount
        Decimal deliveredQty
        Decimal remainingQty
        int version
        datetime deletedAt
    }

    SalesOrderRevision {
        string id PK
        string salesOrderId FK
        int revisionNo
        SalesOrderRevisionStatus revisionStatus
        string changeReason
        Json snapshotData
        datetime deletedAt
    }

    SalesOrderSnapshot {
        string id PK
        string salesOrderId FK
        SalesOrderSnapshotType snapshotType
        int revisionNo
        Json snapshotData
        datetime deletedAt
    }
```

### 关系与约束（真实 Schema，migration 0015）

| 关系 | 基数 | onDelete | 说明 |
| --- | --- | --- | --- |
| Quotation → SalesOrder | 1:1 | Restrict | 一报价一订单（quotationId UK）；唯一入口 convert |
| Customer → SalesOrder | 1:N | Restrict | 有订单的客户不可物理删 |
| Project → SalesOrder | 1:N | Restrict | 项目可空 |
| WorkflowInstance → SalesOrder | 1:N | SetNull | 审批实例删除不影响投影 |
| SalesOrder → SalesOrderLine | 1:N | Cascade | 行随单据软删 |
| Item → SalesOrderLine | 1:N | Restrict | 物料可空 |
| QuotationPriceSnapshot → SalesOrderLine | 1:N | SetNull | 价格快照（继承 Quotation，ADR-0015） |
| SalesOrder → SalesOrderRevision | 1:N | Cascade | 修订历史随单据 |
| SalesOrder → SalesOrderSnapshot | 1:N | Cascade | 快照随单据 |
| SalesOrder → Delivery | 1:N | Restrict | 交付事实源（Sprint 4C，ADR-0018）；有交付的订单不可物理删 |
| SalesOrderLine → DeliveryLine | 1:N | SetNull | 交付行溯源（SO Line 软删后 SetNull） |

### 状态机与业务规则（Sprint 4B）

- **状态流转**：DRAFT → CONFIRMED → PARTIALLY_DELIVERED → DELIVERED（→ COMPLETED 待 4D）；DRAFT/CONFIRMED → CANCELLED
- **Action API 锁定**：convert（唯一入口）/ confirm / cancel 独立端点，不 PATCH status
- **Revision 系统生成**：头/行商业内容变更自动 revisionNo+1；不开放自由编辑
- **Snapshot 固化节点**：CREATED / CONFIRMED / CANCELLED（DELIVERED 由 4C 补充）
- **乐观锁**：头/行 PATCH 必带 version，冲突 409 VERSION_CONFLICT
- **审批门禁**：confirm 时若 workflowInstanceId 非空必须 approvalStatus=APPROVED（CTO Final Review 阻断项③）
- **交付联动（4C）**：confirm-delivery 后按全部 SO Line remainingQty<=0 判定 DELIVERED / PARTIALLY_DELIVERED + deliveredAt 回写

## 21. Delivery Foundation（Sprint 4C，ADR-0018）

> 定位（CTO Review 94/100 锁定）：**Delivery 是交付事实源，SalesOrder 仅保存聚合投影**；
> Direct Delivery 禁止（salesOrderId NOT NULL，唯一入口 `POST /api/sales-orders/{id}/deliveries`）；超交禁止（availableQty 动态计算，不新增 allocatedQty 列）；
> DELIVERED=客户确认收货（业务确认动作）；POD=File Center 存文件 + Delivery 最小投影（不建 DeliveryPOD 表）；
> READY 后行彻底冻结（不支持重新 ready，错误→cancel→新建）；COMPLETED 仅枚举不提供 /complete。

```mermaid
erDiagram
    SalesOrder ||--o{ Delivery : fulfills
    Customer ||--o{ Delivery : receives
    Delivery ||--o{ DeliveryLine : contains
    SalesOrderLine ||--o{ DeliveryLine : traces_to
    Item ||--o{ DeliveryLine : references
    UnitOfMeasure ||--o{ DeliveryLine : measures
    Delivery ||--o{ DeliveryRevision : versions
    Delivery ||--o{ DeliverySnapshot : snapshots

    Delivery {
        string id PK
        string code UK
        string salesOrderId FK
        string customerId FK
        DeliveryStatus status
        datetime deliveryDate
        datetime expectedArrivalDate
        string carrier
        string trackingNo
        DeliveryPodStatus podStatus
        datetime podReceivedAt
        string podConfirmedById
        int version
        datetime deletedAt
    }

    DeliveryLine {
        string id PK
        string deliveryId FK
        string sourceSalesOrderLineId FK
        int lineNo
        string itemId FK
        string description
        Decimal quantity
        string uomId FK
        Decimal orderedQty
        Decimal deliveredQty
        int version
        datetime deletedAt
    }

    DeliveryRevision {
        string id PK
        string deliveryId FK
        int revisionNo
        DeliveryRevisionStatus revisionStatus
        string changeReason
        Json snapshotData
        datetime deletedAt
    }

    DeliverySnapshot {
        string id PK
        string deliveryId FK
        DeliverySnapshotType snapshotType
        int revisionNo
        Json snapshotData
        string generatedById
        datetime generatedAt
        datetime deletedAt
    }
```

### 关系与约束（真实 Schema，migration 0016）

| 关系 | 基数 | onDelete | 说明 |
| --- | --- | --- | --- |
| SalesOrder → Delivery | 1:N | Restrict | Direct Delivery 禁止；有交付的订单不可物理删 |
| Customer → Delivery | 1:N | Restrict | 收货客户（继承 SO.customerId） |
| Delivery → DeliveryLine | 1:N | Cascade | 行随单据软删 |
| SalesOrderLine → DeliveryLine | 1:N | SetNull | 交付行溯源（SO Line 软删后 SetNull） |
| Item → DeliveryLine | 1:N | Restrict | 物料可空 |
| UnitOfMeasure → DeliveryLine | 1:N | SetNull | 交付单位 |
| Delivery → DeliveryRevision | 1:N | Cascade | 修订历史随单据 |
| Delivery → DeliverySnapshot | 1:N | Cascade | 快照随单据 |

- `Delivery.code` 唯一（DocumentSequence docType=DELIVERY_ORDER，前缀 DO，位数 6）；`DeliveryLine @@unique([deliveryId, lineNo])`；`DeliveryRevision @@unique([deliveryId, revisionNo])`；`DeliverySnapshot @@unique([deliveryId, snapshotType])`
- SalesOrderLine 投影列（0016 新增）：`deliveredQty Decimal @default(0)`（仅 confirm-delivery 回写累计）、`remainingQty Decimal`（迁移初始化为 quantity）

### 状态机与业务规则（Sprint 4C）

- **状态流转**：DRAFT → READY → DISPATCHED → DELIVERED（→ COMPLETED 仅枚举，4D 再实现）；DRAFT/READY → CANCELLED
- **Action API 锁定**：ready / dispatch / confirm-delivery / cancel 独立端点，不 PATCH status；
- **防超交（核心）**：创建/编辑行与 ready/confirm 时事务内动态计算 `confirmedDeliveredQty`（DELIVERED/COMPLETED 合计）+ `openDeliveryQty`（其他 DRAFT/READY/DISPATCHED 合计，PATCH 自身行排除当前行）→ `availableQty = orderedQty - confirmed - open` → 校验 quantity <= availableQty，超出 → 409 DELIVERY_QUANTITY_EXCEEDED
- **锁序防死锁**：confirm-delivery 固定顺序（锁 Delivery → 锁 SalesOrder → 按 id ASC 锁全部源行），多 Delivery 并发 confirm 同一 SO Line 不产生死锁
- **聚合回写**：confirm-delivery 后对每个 SalesOrderLine 回写 deliveredQty/remainingQty，再聚合 SO（全部行 remainingQty<=0 → DELIVERED + deliveredAt=now；否则有 confirmed → PARTIALLY_DELIVERED）；不因 READY/DISPATCHED 提前标记
- **POD 门禁**：confirm-delivery 要求 podStatus ∈ {RECEIVED, WAIVED}，否则 409；RECEIVED 时回填 podReceivedAt/podConfirmedById
- **快照固化节点**：CREATED / READY / DISPATCHED / DELIVERED / CANCELLED（金额/数量一律 toString，禁止 toNumber）
- **Decimal 全程**：数量/聚合/快照全部 Prisma.Decimal，不转 number 做加减
- **红线**：不开发 Invoice/Payment；无 DeliveryPOD 独立表；物流不自动触发 DELIVERED

## 22. Invoice Foundation（Sprint 4D，ADR-0019）

> 定位（CTO Review 96/100 锁定）：**Invoice 是财务事实源**（Delivery 为物流事实源，Invoice 为财务事实源，职责分离互不重算）；
> Invoice 唯一来源 Delivery（禁 Direct Invoice，唯一入口 `POST /api/deliveries/{id}/invoice`）；
> 金额永不重算（四段溯源链取价：DeliveryLine→sourceSalesOrderLineId→SalesOrderLine→priceSnapshotId→QuotationPriceSnapshot，不调用 Pricing Engine——Pricing 到 SO 为止）；
> 不建 InvoiceApproval/Attachment/Price（复用 Workflow/File Center/价格快照）；无 VOID；Payment 属 4E（paidAmount/balanceAmount 仅投影）。

```mermaid
erDiagram
    Customer ||--o{ Invoice : billed_to
    Delivery ||--o{ Invoice : invoiced_from
    Invoice ||--o{ InvoiceLine : contains
    DeliveryLine ||--o{ InvoiceLine : traces_to
    Item ||--o{ InvoiceLine : references
    UnitOfMeasure ||--o{ InvoiceLine : measures
    QuotationPriceSnapshot ||--o{ InvoiceLine : priced_by
    WorkflowInstance ||--o{ Invoice : approves
    Invoice ||--o{ InvoiceRevision : versions
    Invoice ||--o{ InvoiceSnapshot : snapshots

    Invoice {
        string id PK
        string code UK nullable
        string deliveryId FK
        string salesOrderId
        string customerId FK
        InvoiceStatus status
        datetime invoiceDate
        datetime dueDate
        string currency
        string taxProfileId
        string paymentTerm
        Decimal subtotal
        Decimal taxAmount
        Decimal invoiceTotal
        Decimal paidAmount
        Decimal balanceAmount
        string workflowInstanceId FK
        ApprovalStatus approvalStatus
        datetime approvedAt
        string approvedById
        int version
        datetime deletedAt
    }

    InvoiceLine {
        string id PK
        string invoiceId FK
        string sourceDeliveryLineId FK
        int lineNo
        string itemId FK
        string description
        Decimal quantity
        string uomId FK
        string priceSnapshotId FK
        Decimal unitPrice
        Decimal discountRate
        Decimal lineAmount
        Decimal taxAmount
        Decimal totalAmount
        int version
        datetime deletedAt
    }

    InvoiceRevision {
        string id PK
        string invoiceId FK
        int revisionNo
        InvoiceRevisionStatus revisionStatus
        string changeReason
        Json snapshotData
        datetime deletedAt
    }

    InvoiceSnapshot {
        string id PK
        string invoiceId FK
        InvoiceSnapshotType snapshotType
        int revisionNo
        Json snapshotData
        string taxProfileId
        Decimal taxRate
        string sstNo
        Decimal currencyRate
        Decimal exchangeRate
        string generatedById
        datetime generatedAt
        datetime deletedAt
    }
```

### 关系与约束（真实 Schema，migration 0017）

| 关系 | 基数 | onDelete | 说明 |
| --- | --- | --- | --- |
| Delivery → Invoice | 1:N | Restrict | Invoice 唯一来源 Delivery（Direct Invoice 禁止）；有发票的交付不可物理删 |
| Customer → Invoice | 1:N | Restrict | 开票客户（继承 Delivery.customerId） |
| Invoice → InvoiceLine | 1:N | Cascade | 行随单据软删 |
| DeliveryLine → InvoiceLine | 1:N | SetNull | 开票行溯源（DeliveryLine 软删后 SetNull） |
| Item → InvoiceLine | 1:N | Restrict | 物料可空（继承 DeliveryLine.itemId） |
| UnitOfMeasure → InvoiceLine | 1:N | SetNull | 开票单位 |
| QuotationPriceSnapshot → InvoiceLine | 1:N | SetNull | 价格快照（四段溯源链末端，直接复制不重算） |
| WorkflowInstance → Invoice | 1:N | SetNull | 审批实例（Workflow 唯一事实源；不建 InvoiceApproval 表） |
| Invoice → InvoiceRevision | 1:N | Cascade | 修订历史随单据 |
| Invoice → InvoiceSnapshot | 1:N | Cascade | 快照随单据 |

- `Invoice.code` **可空唯一**（CTO 必改①：DRAFT 不占号 code=NULL，仅 ISSUE 时 DocumentSequence 取号 INV-2026-000123）；`InvoiceLine @@unique([invoiceId, lineNo])`；`InvoiceRevision @@unique([invoiceId, revisionNo])`；`InvoiceSnapshot @@unique([invoiceId, snapshotType])`
- DeliveryLine 开票投影列（0017 新增）：`invoicedQty Decimal @default(0)`（仅开票/cancel 回写）、`remainingInvoiceQty Decimal`（迁移初始化为 quantity）
- InvoiceSnapshot 税务/汇率快照（CTO 必改②）：`taxProfileId / taxRate / sstNo / currencyRate / exchangeRate`，多年后 100% 还原

### 状态机与业务规则（Sprint 4D）

- **状态流转**：DRAFT → ISSUED → PARTIALLY_PAID → PAID；DRAFT → CANCELLED（PARTIALLY_PAID/PAID 由 4E Receipt 回写，本阶段仅枚举；无 VOID，ISSUED+ 取消语义后续交 Credit Note）
- **Action API 锁定**：create（POST /api/deliveries/{id}/invoice）/ issue / cancel 独立端点，不 PATCH status；InvoiceLine 无 PATCH（系统生成只读）
- **唯一入口**：禁 Direct Invoice（无 POST /api/invoices）；开票前置 Delivery.status = DELIVERED（仅已确认收货可开票，否则 409 INVOICE_INVALID_STATE）
- **Partial Billing（CTO 拍板①）**：DeliveryLine 加 invoicedQty/remainingInvoiceQty 投影；开票 qty>0 且 ≤ remainingInvoiceQty（锁内读），超出 → 409 INVOICE_QUANTITY_EXCEEDED；cancel 对称回滚（invoicedQty -= qty / remainingInvoiceQty += qty）
- **Consolidated Invoice（CTO 拍板②）**：primaryDeliveryId + deliveryIds[]，Customer/Currency/TaxProfile/PaymentTerm 必须一致，否则 409 INVOICE_SOURCE_NOT_COMPATIBLE；锁序按 id ASC 防死锁
- **四段溯源链取价（金额红线）**：InvoiceLine ← DeliveryLine.sourceSalesOrderLineId ← SalesOrderLine.priceSnapshotId ← QuotationPriceSnapshot（priceSnapshotId/unitPrice/discountRate/lineAmount/taxAmount/totalAmount 直接复制，不调用 Pricing Engine）
- **DRAFT 不占号 + Issue 原子取号（CTO 必改①）**：创建 code=NULL；issue 事务内 FOR UPDATE 锁 Invoice → 校验（DRAFT + 有行 + total>0 + code=null）→ 审批门禁（workflowInstanceId ≠ null 时仅 APPROVED 可开票，否则 409）→ nextInvoiceCode 原子取号 → ISSUED；并发 issue 第二个请求稳定 409 不消耗编号
- **Workflow 集成（CTO 拍板同构）**：ApprovalPolicy(module=INVOICE) → WorkflowDefinition → WorkflowInstance 单实例（@@unique([businessType, businessId])）；终态回写投影（COMPLETED→APPROVED + approvedAt/approvedById；REJECTED→REJECTED）；不建 InvoiceApproval 表、不生成 APPROVED 快照（快照仅 CREATED/ISSUED/CANCELLED）；PATCH 重审：paymentTerm/dueDate 变更 → 同事务 maybeTriggerInvoiceApproval（无实例创建 / RUNNING 保持 / 终态复用 resubmit）；remark 不触发；策略缺失 → 409 INVOICE_WORKFLOW_FAILED 整体回滚
- **快照固化节点**：CREATED / ISSUED / CANCELLED（Header + Lines + sourceDeliveryLineId 集合；金额/数量一律 toString 禁止 toNumber；ISSUED 快照 snapshotData 含 issuedAt/issuedById——schema 无 issuedAt/issuedById 列，与 4C deliveredAt 同款模式）
- **Decimal 全程**：金额/数量/投影/快照全部 Prisma.Decimal（金额 18,4 / 汇率 18,8），不转 number 做加减
- **红线**：不开发 AR/Payment/Credit Note（paidAmount/balanceAmount 固定 0 投影，4E 回写）；无 InvoiceApproval/Attachment/Price 表；不调用 Pricing Engine；InvoiceLine 不自由编辑

## 23. Accounts Receivable Foundation（Sprint 4E-1，ADR-0020）

> 定位（CTO Review 97/100 APPROVED WITH CHANGES 锁定）：**Invoice = 单据事实源；AccountsReceivable = 余额事实源**（Invoice 上 paidAmount/balanceAmount 仅投影回写）；
> AR 唯一来源 Invoice（1:1，invoiceId @unique；Invoice ISSUED 后自动创建——拍板①）；
> 余额唯一口径 `balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount`（服务端唯一计算，前端禁止 PATCH 金额，由 4E-2 Receipt/4E-3 CN-DN 动作或下游事实表驱动）；
> OVERDUE 惰性投影（拍板②：不落库、不新增 Scheduler，与 Quotation EXPIRED 一致）；agingBucket 不存库（必改①：effectiveAgingBucket 读取时动态计算 0-30/31-60/61-90/90+）；
> Snapshot 含 snapshotSource 来源枚举（必改②：ISSUE/PAYMENT/WRITE_OFF/ADJUSTMENT/MANUAL）；Invoice 删除保护（必改③：Restrict，Cancel 也不删 AR 只能 CLOSED）；
> Workflow 边界（必改④：AR 不审批；Receipt/WriteOff × ApprovalPolicy 属 4E-2）；Migration 0018 只新增不动 Invoice；无 VOID（CLOSED 承载生命周期结束）。

```mermaid
erDiagram
    Invoice ||--|| AccountsReceivable : balances
    Customer ||--o{ AccountsReceivable : owes
    AccountsReceivable ||--o{ AccountsReceivableRevision : versions
    AccountsReceivable ||--o{ AccountsReceivableSnapshot : snapshots

    AccountsReceivable {
        string id PK
        string invoiceId FK UK
        string customerId FK
        string currency
        Decimal originalAmount
        Decimal adjustedAmount
        Decimal paidAmount
        Decimal writeOffAmount
        Decimal balanceAmount
        AccountsReceivableStatus status
        AccountsReceivableStatus effectiveStatus
        datetime dueDate
        datetime lastPaymentAt
        int version
        datetime deletedAt
    }

    AccountsReceivableRevision {
        string id PK
        string accountsReceivableId FK
        int revisionNo
        string changeReason
        Json snapshotData
        datetime deletedAt
    }

    AccountsReceivableSnapshot {
        string id PK
        string accountsReceivableId FK
        AccountsReceivableSnapshotType snapshotType
        AccountsReceivableSnapshotSource snapshotSource
        int revisionNo
        Json snapshotData
        string generatedById
        datetime generatedAt
        datetime deletedAt
    }
```

### 关系与约束（真实 Schema，migration 0018）

| 关系 | 基数 | onDelete | 说明 |
| --- | --- | --- | --- |
| Invoice → AccountsReceivable | 1:1 | Restrict | 单据事实源 → 余额事实源；有 AR 的发票禁止删除（必改③） |
| Customer → AccountsReceivable | 1:N | Restrict | 客户对账 |
| AR → ARRevision | 1:N | Cascade | 修订历史随记录 |
| AR → ARSnapshot | 1:N | Cascade | 快照随记录 |

- `AccountsReceivable.invoiceId @unique`（1:1）；`ARRevision @@unique([accountsReceivableId, revisionNo])`；`ARSnapshot @@unique([accountsReceivableId, snapshotType])`
- **无 agingBucket 列**（必改①：effectiveAgingBucket 动态计算，只依赖 today/dueDate/balance，属 Projection，不每天更新数据库）
- **无审批字段**（必改④：AR 不建审批表、不挂 ApprovalPolicy——Receipt/WriteOff × ApprovalPolicy 属 4E-2）

### 状态机与业务规则（Sprint 4E-1）

- **状态流转**：Invoice ISSUED → 自动创建 AR（OPEN）→（4E-2）PARTIALLY_PAID → PAID；OVERDUE 惰性投影（status∈{OPEN,PARTIALLY_PAID} + dueDate<now，不落库）；CLOSED = 余额=0 且生命周期结束（CTO Review 追加 AccountsReceivableClosed 事件）
- **Action API 锁定**：本阶段仅查询（列表/详情/aging/revisions/snapshots）；无 POST/PATCH——AR 由 Invoice ISSUED 自动创建（拍板①），金额由 4E-2/4E-3 动作驱动
- **余额唯一口径**：balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount（computeBalance 单入口，禁止多处计算）
- **快照固化节点**：CREATED / PARTIALLY_PAID / PAID / ADJUSTED / WRITTEN_OFF / CLOSED（金额一律 toString 禁止 toNumber）；snapshotSource 来源枚举（必改②）
- **Decimal 全程**：金额 Decimal(18,4)；投影计算 Number 仅用于展示不写库
- **红线**：不开发 4E-2（Receipt/Payment）/ 4E-3（CN/DN）；无 WriteOff/Adjustment 独立表；不修改 Invoice 表；AR 不审批

## 24. 变更记录

### v1.12（2026-08-08，Sprint 4E-1 Accounts Receivable Foundation，ADR-0020，PR #16 已合并）

- 新增章节：23. Accounts Receivable Foundation（Sprint 4E-1，AR 余额事实源 + 3 模型 + 1:1 Invoice + 余额唯一口径 + 惰性投影）
- 模型：+3（AccountsReceivable/AccountsReceivableRevision/AccountsReceivableSnapshot）；枚举：+3（AccountsReceivableStatus/AccountsReceivableSnapshotType/AccountsReceivableSnapshotSource）
- Invoice +1 反向关系（accountsReceivable）；Customer +1 反向关系（accountsReceivables）；无 agingBucket 列（CTO 必改①动态计算）
- 第 6 节已落地列表：Accounts Receivable Foundation（4E-1，PR #16 待验收）移入验收中

### v1.11（2026-08-08，Sprint 4D Invoice Foundation，ADR-0019，PR #15 已合并）

- 新增章节：22. Invoice Foundation（Sprint 4D，Invoice 财务事实源 + 4 模型 + 四段溯源链取价 + Partial/Consolidated Billing + Issue 原子取号 + Workflow 集成）
- 模型：+4（Invoice/InvoiceLine/InvoiceRevision/InvoiceSnapshot）；枚举：+4（InvoiceStatus/InvoiceSnapshotType/InvoiceRevisionStatus/InvoiceLineStatus）
- DeliveryLine +2 投影列（invoicedQty/remainingInvoiceQty，remainingInvoiceQty 迁移初始化为 quantity）；Invoice.code 可空（DRAFT 不占号）；InvoiceSnapshot +5 税务/汇率快照字段
- 第 6 节已落地列表：Invoice Foundation（4D，PR #15 已合并）移入已落地

### v1.10（2026-08-07，Sprint 4B/4C Sales Order + Delivery Foundation，ADR-0017/0018）

- 新增章节：20. Sales Order Foundation（Sprint 4B，convert 唯一入口 + CRUD/Lines/Actions + Workflow 条件触发 + 交付投影）
- 新增章节：21. Delivery Foundation（Sprint 4C，交付事实源 + 4 模型 + 防超交 + 12 步 confirm 事务 + SO 聚合回写）
- 模型：+8（SalesOrder/SalesOrderLine/SalesOrderRevision/SalesOrderSnapshot + Delivery/DeliveryLine/DeliveryRevision/DeliverySnapshot）；枚举：+7（SalesOrderStatus/SalesOrderSnapshotType/SalesOrderRevisionStatus + DeliveryStatus/DeliverySnapshotType/DeliveryRevisionStatus/DeliveryPodStatus）
- SalesOrderLine +2 投影列（deliveredQty/remainingQty）；SalesOrder +deliveredAt（交付完成时间投影）
- 第 6 节已落地列表：Sales Order Foundation（4B，PR #13 已合并）+ Delivery Foundation（4C，PR #14 待验收）移入已落地


### v1.9（2026-08-07，Sprint 4A Quotation Foundation，ADR-0015/0016）

- 新增章节：19. Quotation Foundation（Quotation/QuotationLine/QuotationRevision/QuotationSnapshot + ApprovalPolicy 复用）
- 模型：+4（Quotation 域，不含 3C-4 既有 QuotationPriceSnapshot）；枚举：+3（QuotationStatus/QuotationSnapshotType/QuotationRevisionStatus）
- 状态机表格新增：报价状态（含 EXPIRED 惰性投影）/快照类型/修订状态
- 第 6 节已落地列表：Quotation Foundation 从规划中移入已落地（Sprint 4A，PR #12 验收中）
- 预留声明：convert（Sprint 4B）与 SENT 发送动作（后续阶段）未在 4A 实现

### v1.8（2026-08-06，Sprint 3C-3 Item Master Foundation，ADR-0012）

- 新增章节：17. Item Master Foundation（ItemType 10 类/五级层级/多 UOM/ItemSpecification/ItemCost/SupplierItem/ItemRevision/ItemTag）
- 模型：79 → 86（+ItemCategory 树/ItemSpecification/UomConversion/ItemCost/SupplierItem/ItemRevision/ItemTag）
- 枚举：37 → 40（+ItemStatus/ItemCostType/AttachmentType；ItemCategory→ItemType 扩展 10 类；ItemLifecycle 重命名五值）
- Item 升级：itemType/categoryId/series/model/variant/barcode/qrCode/revision/status/多 UOM/isSalable/isPurchasable/isManufacturable
- FileAttachment + attachmentType（统一放 File Center，CTO #2075）

### v1.7（2026-08-06，Sprint 3C-2 Supplier Foundation，ADR-0010）

- 新增章节：17. Supplier Foundation（BusinessPartnerRole + Partner 五共享 + Supplier 三独有）
- 模型：69 → 79；枚举：33 → 37

### v1.6（2026-08-05，Sprint 3C-1 Customer Foundation，ADR-0009）

- 新增章节：16. Customer Foundation（Customer/Contact/Address/Tag/Industry/Credit）
- 模型：62 → 69；枚举：29 → 33
