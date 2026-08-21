# Business UX Rationalization Phase 2 — Deep Business Semantics / 深层业务语义整改

> 来源：ChatGPT 共享对话（t_6a879858e2a08191859b9cc46e473f5f，2026-08-21）
> 状态：正式主提示词（替换 Phase 1 主提示词，作为后续开发统一执行标准）
> 前提：Phase 1（Batch 1–15，表现层整改）已全部合并 main

## 0. 阶段判断

重新分析后，开发阶段已经发生变化。

最新已完成：**Business UX Rationalization Batch 1–15** 已合并；当前查询没有开放 PR。仓库 ROADMAP 已到 **v1.40（2026-08-21）**。

现有正式规范仍将阶段定义为「业务页面合理性整改 + 关键流程体验收口 + Runtime Acceptance」，并明确要求从业务角色、字段、状态机和实际流程设计页面。

但过去 15 个 Batch 实际已经大量解决了**第一层问题**：枚举中文化、技术字段隐藏、金额口径/对齐、空态、业务日期、状态展示等。

所以后面继续用原提示词，会出现一个风险：Agent 继续扫「中文 label」这类低价值残留，却没有深入解决最开始指出的**字段本身和业务逻辑不合理**。

### 新阶段定义

下一轮定义为：

**Business UX Rationalization Phase 2 — Deep Business Semantics / 深层业务语义整改**

重点从「页面」升级成「页面 + 字段 + 状态机 + 业务流程」：

> 为什么有这个字段、谁填写、什么时候填写、从哪里来、修改后影响什么、状态变化后还能不能改

尤其重点审查五类问题：**字段所有权、来源单据继承、阶段性必填、跨字段业务约束、状态动作副作用**。

现有规范其实已经要求这些内容，但此前执行更多落在表现层。下面这版直接替换后续开发主提示词。

---

## 一、主提示词（Master Prompt，Phase 2）

你正在继续开发 Linier CRM。

当前仓库已经完成：
- Sprint 8 UI Modernization
- A-3 / A-4 CAS 并发安全整改
- Business UX Rationalization Phase 1 / Batch 1–15

已经大范围完成：
- 原始枚举中文化
- 技术字段隐藏
- 金额/数量显示规范
- 空态
- 业务日期替代审计日期
- 基础状态展示
- 列表基础可读性

除非发现明确回归，不要继续把主要精力花在上述表面问题。

当前正式进入：

```
==================================================
Business UX Rationalization Phase 2
Deep Business Semantics / 深层业务语义整改
==================================================
```

核心目标：

不是继续「页面更整齐」，而是验证并修正：

1. 这个字段为什么存在
2. 谁负责提供这个字段
3. 用户在这个阶段是否真的知道它
4. 它应该手工输入、自动带出、计算得到还是完全只读
5. 来源单据已经确定的事实是否还能被下游任意修改
6. 字段之间是否存在业务约束
7. 当前状态允许哪些动作
8. 动作完成后产生了哪些不可逆业务事实
9. 前端行为是否与 API / 状态机 / RBAC / 会计 / 库存事实完全一致
10. 一个真实业务人员是否能自然完成整条流程

### 一、整改任何页面前，必须完整阅读其业务上下文

至少检查：
- 当前 page / component
- Prisma model
- create schema
- update schema
- GET API
- POST API
- PATCH API
- action APIs
- enums
- 状态机
- RBAC permission
- CAS / FOR UPDATE 规则
- 来源单据关系
- 下游单据关系
- domain event / outbox（如存在）
- GL / Inventory side effect（如存在）
- 相关 ADR
- 相关 QA / test-cases
- 相邻上游和下游页面

禁止仅根据 JSX 推断业务规则。

如果 UI、API、Schema、ADR 之间冲突：**必须指出冲突，不能选择其中一个静默适配。**

### 二、每个页面先建立 Field Decision Matrix

编码前必须逐字段审计。为每个业务字段判断：

**字段：**
- 中文业务名称
- 数据库字段
- 业务含义

**来源：**
- 用户输入
- 客户主数据
- 供应商主数据
- 物料主数据
- 价格体系
- 税务配置
- 来源单据
- 系统计算
- 当前用户
- 当前时间
- 后端派生

**阶段：**
- 创建时需要
- 保存草稿时需要
- 提交时需要
- 审批时需要
- 执行时需要
- 过账时需要
- 完成后只读

**行为：**
- 必填
- 可选
- 自动带出
- 计算字段
- 只读
- 隐藏
- 条件显示

**编辑权限：**
- 哪些状态可改
- 哪些状态不可改
- 来源单据生成后是否锁定
- 是否只能通过 reversal / amendment / CN/DN 等正式流程修改

**依赖：**
- 依赖什么字段
- 改变它是否应该重新计算其它字段
- 是否影响价格
- 是否影响税额
- 是否影响库存
- 是否影响会计
- 是否影响审批

**验证：**
- 前端即时验证
- 后端 authoritative validation
- 错误码
- 用户业务提示

禁止没有完成 Field Decision Matrix 就直接改表单。

### 三、字段所有权必须明确

每个字段必须只有明确的业务来源。

特别检查：

**客户选择后：**
- 开票抬头
- 税号
- 纳税人类型
- 默认币种
- 付款条件
- 收货地址
- 联系人
- 价格体系

**供应商选择后：**
- 付款条件
- 银行信息
- 税务信息
- 默认币种
- 采购条款

**物料选择后：**
- UOM
- 税率
- 规格
- 默认仓库
- 参考价格
- itemType

**来源单据生成下游单据后：**
原则上继承已经成立的业务事实。

例如：Quotation → Sales Order → Delivery → Invoice → AR → Receipt → Allocation / Reversal / WriteOff / CN-DN，逐字段判断哪些继承、哪些重算、哪些在特定阶段才开放。

禁止下游页面默认把所有来源字段重新开放编辑。

### 四、创建时必填 ≠ 提交时必填

重新检查所有 required 字段。必须区分：

- **SAVE DRAFT**：只要求能识别单据、能安全保存当前工作
- **SUBMIT**：要求满足业务完整性
- **APPROVE**：要求满足审批条件
- **EXECUTE / ISSUE / POST**：要求满足形成业务事实的全部条件

例如：

草稿阶段不应该因为以下原因而无法保存：
- 未来交期未确认
- 审批人未确定
- 发票号码未产生
- 实际收货日期未知
- 实际付款信息未知

反过来：提交/执行时不能缺少真正关键的数据。

禁止为了 Schema 方便，把所有字段都设成创建时必填。

### 五、建立 Action / State Matrix

每个业务单据必须明确 State → 可执行动作（按业务定义）。

每一个动作必须检查：

1. 前端是否显示
2. 前端是否错误显示
3. API 是否允许
4. RBAC 是否允许
5. 是否需要 version
6. 是否需要 CAS
7. 是否需要 FOR UPDATE
8. 是否幂等
9. 是否产生 Domain Event
10. 是否产生库存事实
11. 是否产生 GL 事实
12. 是否能合法撤销
13. 撤销应该使用什么正式业务动作

禁止：
- 完成单据重新普通编辑
- 已过账业务事实直接 PATCH
- 通过隐藏按钮代替后端状态门禁
- 前端允许但 API 必然拒绝的操作
- API 允许但 UI 完全没有业务入口的核心动作

### 六、深入检查跨字段业务规则

不要只做单字段 required 校验。必须扫描字段之间的关系。

**日期：**
- expectedDeliveryDate >= orderDate
- dueDate >= invoiceDate
- receiptDate 与 PO / shipment 时间关系
- accountingPeriod 与 postingDate 关系
- closed period 禁止普通过账

**数量：**
- deliveryQty <= remainingDeliverableQty
- invoiceQty <= remainingInvoiceableQty
- receiptQty <= allowedReceiptQty（考虑业务容差）
- returnQty <= returnableQty
- allocatedQty / amount <= open balance
- stock action 不允许产生非法余额（按系统既有规则）

**金额：**
- subtotal / discount / tax / total / paid / allocated / outstanding
- 必须确认 canonical source
- 禁止页面自己重新发明金额公式

**税：**
- taxable amount / tax rate / tax amount
- tax-inclusive / exclusive price
- 必须与后端口径一致

**价格：**
明确价格来源：price list / negotiated price / quotation snapshot / PO snapshot / manual override。
如果允许 override：必须明确权限、原因和审计。

### 七、重点审查 Derived Fields

以下类型字段原则上不应该普通手填：
- subtotal
- taxAmount
- totalAmount
- balance
- openAmount
- remainingQty
- deliveredQty
- receivedQty aggregation
- invoiceableQty
- grossProfit
- inventoryValue
- averageCost
- GL totals
- approvalStatus
- version

必须找到 canonical backend source。UI 只展示或触发后端重新计算。

禁止 `quantity × unitPrice` 这种前端估算值替代服务端正式金额，除非该字段明确只是未保存的 Preview，并明确标注 Preview。

### 八、页面结构按照业务问题设计

不要再按照数据库字段分组。

**列表页回答：**「我现在应该处理哪一张单」
优先：单号、对象、状态、关键业务日期、金额、剩余量、履约进度、风险/异常、下一动作。

**详情页回答：**「这张单现在发生了什么，我下一步能做什么」
顶部必须优先：身份、当前状态、当前业务对象、关键金额、关键日期、当前可执行动作。
然后才是：商务条件、明细、履约、财务、审批、附件、审计信息。

**新建页回答：**「完成这一步最少需要填写什么」
不得要求用户提前填写未来才会知道的信息。

### 九、主数据不是普通 CRUD

主数据页面必须重新检查业务使用价值。

**Business Partner：**
不要只考虑「录入」；要考虑：销售使用什么、采购使用什么、财务使用什么、开票使用什么、信用和结算使用什么。

**Item：**
重点考虑：采购、销售、库存、成本、税务、UOM、规格、生命周期。

**Price：**
明确：价格表、有效期、币种、含税/未税、客户价格、供应商价格、override。

低频企业档案字段不得淹没日常操作字段。

### 十、不要用前端修补错误的后端契约

如果发现真正的问题在：
- Prisma model
- API contract
- 状态机
- permission
- event payload
- accounting logic
- inventory logic

不要通过前端 workaround 掩盖。必须标记：

```
CONTRACT ISSUE
```

并说明：
- Current Contract
- Expected Business Contract
- Affected Modules
- Migration Impact
- Compatibility Impact
- Required Tests

普通 UX PR 不得静默改变：会计事实、库存事实、状态语义、Domain Event、DB Schema。

如果确需改变这些内容：先做 Design Gate / ADR，再独立实施。

### 十一、Runtime Acceptance 升级

lint/type-check/unit/build 全绿只是最低门槛，不是业务验收完成。

每批必须设计真实业务 Runtime Flow：

**销售至少覆盖：** Quotation → SO → Delivery → Invoice → AR → Receipt → Allocation / Reversal / WriteOff / CN-DN
**采购至少覆盖：** Requisition → PO → Receipt → Inspection → Return → WHR → Supplier Invoice → AP → Payment
**库存至少覆盖：** Inbound / Outbound / Transfer / Adjustment / Conversion / Stock Count
**财务至少覆盖：** Business Event → GL Entry → Period Close

每条流程同时验证：
- 正常路径
- 非法状态动作
- 无权限
- 重复提交
- stale version / CAS 409
- 超量
- 超额
- reversal
- 数据刷新后的 UI 状态

### 十二、每个 Batch 的执行方法

每次只处理：**1 个业务流程** 或 **1–3 个强关联页面**。

开始前先输出：

```
## Business Context
真实使用角色和任务。

## Current Contract
页面 / API / Schema / State Machine 当前事实。

## Field Decision Matrix
逐字段决策。

## Action Matrix
逐状态动作决策。

## Problems Found
按严重度：
P0 数据/会计/库存事实错误
P1 业务流程错误
P2 字段/必填/继承/编辑权限错误
P3 可用性问题
P4 纯视觉问题

优先解决 P0。P4 不得单独占据主要开发批次，除非是明确回归。

## Proposed Changes
Frontend / Backend / Validation / Tests

如果不需要后端变化，要明确：Backend Contract Preserved
```

完成分析后再编码。

### 十三、实现约束

必须保持：
- CAS
- FOR UPDATE
- optimistic concurrency
- RBAC
- audit
- soft delete
- domain events
- transactional outbox
- idempotency
- accounting invariants
- inventory ledger SSOT
- server-side canonical financial calculations

除非当前任务明确就是整改对应架构。

禁止新增无必要依赖。
禁止大爆炸式改几十个不相关页面。
禁止一次 PR 混入：无关重构、纯格式整理、顺手改名、unrelated feature。

### 十四、CI-First

遵守仓库 CI-First / No Local Server 规则。最终验证事实以 GitHub CI 为准：
- lint
- type-check
- unit
- build
- secret scanning（如 workflow 包含）

涉及业务规则时必须补测试。优先测试：
- 状态 transition
- required-at-stage
- amount / quantity boundary
- CAS conflict
- permission
- idempotency
- reversal
- derived value

不要只测试 React 是否渲染。

### 十五、PR 输出标准

每个 PR 必须包含：

```
## Business Problem
不是「哪个 class 不好看」，而是真实业务问题。

## Root Cause
问题来自：UI / API / Contract / State / Data Source / Validation 中哪一层。

## Field Decisions
关键字段为什么保留/隐藏/自动带出/锁定。

## Action Decisions
状态与动作发生了什么变化。

## Business Rules Preserved
明确列出未改变的事实链。

## Validation
CI 和测试。

## Runtime Acceptance
真实角色、真实业务流。

## Known Risk
仍未验证或无法自动化的内容。
```

### 十六、本阶段完成标准

不要以「页面更中文、更整齐、更漂亮」作为完成标准。

Phase 2 完成必须满足：一个真实业务人员在不知道 Prisma Schema、不知道 API 字段名、不知道数据库枚举的情况下，能够：

1. 理解当前业务事实；
2. 知道下一步动作；
3. 只填写当前阶段真正需要的信息；
4. 自动获得系统已经知道的信息；
5. 不会被允许执行业务上非法的动作；
6. 能清楚理解系统拒绝操作的原因；
7. 从上游单据到下游单据看到连续、一致的业务事实；
8. 金额、数量、库存、会计数据始终来自同一个 canonical source；
9. 冲突、撤销、超额和异常路径有明确处理；
10. 完整关键流程能够通过 Runtime Acceptance。

如果只是「页面更中文了、更整齐了、更漂亮了」但上述条件没有改善，则该 Batch 不算 Business UX Phase 2 的有效进展。

---

## 2. 执行建议（本阶段首个 Batch）

下一批不要再叫 Batch 16 普通扫尾，正式叫：

**Business UX Rationalization Phase 2 Batch 1 — Quotation 链纵向深审**

先从 **Quotation** 链做一次纵向深审，而不是再横扫几十个页面。因为这条链最容易暴露「来源继承、字段锁定、剩余数量、税价口径、状态动作」到底是否真的合理。

之后再按 Purchase 链推进。

这也符合仓库现有规范规定的优先顺序：销售链、采购链、财务是 P0，主数据/库存随后，Project 再后；BI/OA/Mobile 暂不抢占整改优先级。
