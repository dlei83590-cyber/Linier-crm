# Sprint 3C-2 QA — Supplier Foundation（BusinessPartner 唯一主体 + Partner 级共享）

> Sprint：3C-2 | 模块：Supplier Foundation | PR：#8 | 日期：2026-08-06
> 关联：ADR-0010（Supplier Foundation）、ADR-0011（BusinessPartner Consolidation）、ADR-0009（Customer Foundation）
> 架构原则：BusinessPartner 唯一主体，Customer/Supplier 为角色（BusinessPartnerRole），联系人/地址/标签/银行/信用 Partner 级共享。

## 1. 交付范围

### 1.1 Schema（+10 模型 / +4 枚举 → 总计 79 模型 / 37 枚举）
| 类型 | 模型/枚举 | 说明 |
| --- | --- | --- |
| 角色 | BusinessPartnerRole | BusinessPartner 唯一主体的角色表，PartnerRoleType：CUSTOMER/SUPPLIER/BOTH/LOGISTICS/OUTSOURCING（可扩展） |
| 共享 | PartnerContact | 联系人（Customer/Supplier 复用，partnerId FK） |
| 共享 | PartnerAddress | 地址（PartnerAddressType：REGISTERED/BILLING/SHIPPING/WAREHOUSE/FACTORY/INVOICING/CONTACT） |
| 共享 | PartnerTag | 标签关联（复用全局 Tag，@@unique([partnerId, tagId])） |
| 共享 | PartnerBankAccount | 银行账户（收付款共用） |
| 共享 | PartnerCredit | 信用（AR/AP 统一，复用 CustomerCreditRating/Status 枚举） |
| 主档 | Supplier | 供应商（partnerId 必填唯一，type=SUPPLIER/BOTH 校验，status/rating/leadTime/minOrderQty） |
| 独有 | SupplierQualification | 资质（QualificationType 枚举） |
| 独有 | SupplierCertificate | 证书 |
| 独有 | SupplierSettlement | 结算条款 |

所有模型带统一审计字段（id/createdAt/createdBy/updatedAt/updatedBy/version/approvalStatus/isActive/deletedAt/deletedBy→updatedById），软删除、禁止物理删除、onDelete 明确。

### 1.2 迁移 0010_supplier_foundation
10 表 + 4 枚举 + 索引 + 外键；**仅新增，不修改既有表**（CTO 规则）。Supplier.partnerId → BusinessPartner ON DELETE RESTRICT；子表 ON DELETE CASCADE。

### 1.3 RBAC（+10 模块）
supplier / supplier-qualification / supplier-certificate / supplier-settlement / business-partner-role / partner-contact / partner-address / partner-tag / partner-bank-account / partner-credit（MANAGER 动作级全量）。

### 1.4 API（18 路由文件 / 32 端点）
| 分组 | 端点 | 权限 |
| --- | --- | --- |
| 主档 | GET/POST /api/suppliers；GET/PATCH/DELETE /api/suppliers/:id | supplier:* |
| 资质 | GET/POST /:id/qualifications；PATCH/DELETE /:id/qualifications/:qualId | supplier-qualification:* |
| 证书 | GET/POST /:id/certificates；PATCH/DELETE /:id/certificates/:certId | supplier-certificate:* |
| 结算 | GET/POST /:id/settlements；PATCH/DELETE /:id/settlements/:settlementId | supplier-settlement:* |
| 联系人（共享） | GET/POST /:id/contacts；PATCH/DELETE /:id/contacts/:contactId | partner-contact:* |
| 地址（共享） | GET/POST /:id/addresses；PATCH/DELETE /:id/addresses/:addressId | partner-address:* |
| 标签（共享） | GET/POST /:id/tags；DELETE /:id/tags/:tagId | partner-tag:* |
| 银行（共享） | GET/POST /:id/bank-accounts；PATCH/DELETE /:id/bank-accounts/:accountId | partner-bank-account:* |
| 信用（共享） | GET/POST /:id/credit（1:1 upsert） | partner-credit:* |
| 角色 | GET/POST /api/business-partners/:id/roles；DELETE /:id/roles/:roleId | business-partner-role:* |

### 1.5 seed
SEED_SUPPLIERS（SUP-0001 华南轴承 / SUP-0002 华东机电，关联 BP-S-0001/BP-B-0001）+ SEED_PARTNER_ROLES（BP-C-0001→CUSTOMER、BP-S-0001→SUPPLIER、BP-B-0001→BOTH），幂等 upsert。

## 2. 验收清单

### 2.1 Schema / 迁移
- [x] 10 新模型 + 4 新枚举；BusinessPartner 反向关系（roles/partnerContacts/partnerAddresses/partnerTags/partnerBankAccounts/partnerCredit/suppliers）配对
- [x] Tag 反向关系 partnerTags 配对
- [x] 迁移 0010 仅新增表/枚举，未改既有表；索引与外键齐全
- [x] 禁止物理删除（软删 deletedAt）；统一审计字段齐全

### 2.2 业务规则
- [x] Supplier.partnerId 必填 + 唯一；创建时校验 BP type ∈ {SUPPLIER, BOTH}（CUSTOMER 拒绝并提示）
- [x] 创建 Supplier 自动写入 BusinessPartnerRole(SUPPLIER)（事务内幂等 upsert）
- [x] 联系人/地址/标签/银行/信用全部走 Partner 级共享表（supplier.partnerId 定位），不建两套
- [x] 主联系人唯一 / 默认地址唯一 / 默认银行唯一（事务内清除旧值）
- [x] 标签重复 409；信用 1:1 upsert 乐观锁（version 可选）
- [x] 软删除级联子资源（qualifications/certificates/settlements + 共享表按 partnerId）

### 2.3 API 规范（API_GUIDELINES）
- [x] 统一响应 `{success, data, meta}` / 错误 `{success:false, error:{code,message}}`
- [x] 分页过滤（code/name/status/partnerId/isPreferred）+ Zod 校验 + requestMeta 完整审计 + 乐观锁 + 软删除 + transaction + 请求日志
- [x] 错误码统一走 ERROR_CODES（NOT_FOUND/VERSION_CONFLICT/CONFLICT）

### 2.4 文档
- [x] ADR-0010（Supplier Foundation）/ ADR-0011（BusinessPartner Consolidation，Sprint 5 迁移规划）
- [x] Sprint3C2_QA.md（本文档）/ test-cases/Supplier_API.md
- [x] DOMAIN_MODEL v1.7（Supplier ERD + Partner 共享图）/ OpenAPI 草稿（suppliers + partner roles 端点）
- [x] Sprint3.md 流水线状态更新（Supplier=Implementation）

## 3. 已知风险 / 后续项
1. 3C-1 Customer 子模型（CustomerContact/Address/Tag/Credit）暂未迁移 → ADR-0011 已规划 Sprint 5 统一迁移（本次不返工）。
2. BusinessPartner.type 兼容字段保留，长期以 BusinessPartnerRole 为准（Sprint 5 评估废弃 type）。
3. 附件仅存 FileId 元数据，对象存储后续接入（承接 File Center 已知项）。
4. 运行级验证待 Railway 部署后执行（本机禁止 install/build/test，CI 远程验证）。

## 4. CI 验证（远程）
- [ ] Quality Gates（Lint/Prisma/Type-check/单测）
- [ ] Build
- [ ] Secret Scanning
