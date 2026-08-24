# Phase 1A Customer 360 Workspace QA

> 日期：2026-08-24 ｜ CTO Directive Phase 1A（BusinessPartner Customer SSOT Workspace）
> 验证事实源：GitHub CI（Quality Gates / Build / Secret Scanning）

## 范围

- **后端**：GET /api/business-partners/:id 扩展只读聚合（partnerContacts / partnerAddresses / partnerTags / partnerCredit + 既有 roles / invoiceInfoRecord）
- **前端**：新建 Customer 360 Workspace 详情页 /business-partners/[id]（14 tab）；列表页 code 链接 + 行操作「详情」指向详情页
- **不在范围（Phase 2/3 未授权）**：公海（占位）、客户查重、CRM Activity、拜访计划、签到、联系人纪念日/关系、经营/绩效 BI——一律 Coming-by-contract 占位，禁止 mock

## 验收

- [ ] 客户详情围绕 BusinessPartner.id 展开：概览/工商/开票/联系人/地址/信用/标签 tab 正确展示（只读）
- [ ] 商机/项目/报价/销售订单/应收回款 tab 按 customerId 过滤聚合（Sales/AR/Project 由各自 authoritative API 提供）
- [ ] 活动/跟进、公海 tab 显示 Coming-by-contract 占位（无 mock）
- [ ] 列表页「详情」进入 360 页；编辑仍走 /edit

## 边界

- 零 Schema / 零 Migration；零平行模型；零业务字段复制（只读聚合既有权威模型）
- 联系人/地址/信用/标签的写操作（CRUD API）未建——管理留后续 Phase；本阶段只读可见
- 附件未接入往来单位（FileAttachment 无 BusinessPartner 关联，后续 Phase）
