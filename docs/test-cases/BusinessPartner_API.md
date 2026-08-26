# BusinessPartner API 测试用例（客户/供应商主体 SSOT）

> 日期：2026-08-24 ｜ 关联：ADR-0050（SSOT 冻结）；Phase 1A（Customer 360 Workspace）
> 权限：business-partner:view/create/edit/delete（动作级 business-partner:*）
> SSOT：BusinessPartner = 客户/供应商主体；Customer 模型已 DEPRECATE（ADR-0051）

## 范围

- BusinessPartner 主档 CRUD + BusinessPartnerRole（客户/供应商角色）
- **Phase 1A detail aggregate contract**（GET /:id 只读聚合）

## 用例

| # | 场景 | 方法 | 路径 | 权限 | 预期 |
| --- | --- | --- | --- | --- | --- |
| B1 | 往来单位列表（分页+type/isActive 过滤） | GET | /api/business-partners?page=1&pageSize=20&type=CUSTOMER&isActive=true | business-partner:view | 200 + meta |
| B2 | 创建往来单位 | POST | /api/business-partners | business-partner:create | 201 |
| B3 | 详情含 roles | GET | /api/business-partners/:id | business-partner:view | 200 + roles |
| B4 | **详情聚合（Phase 1A）** | GET | /api/business-partners/:id | business-partner:view | 200 + partnerContacts/partnerAddresses/partnerTags/partnerCredit/invoiceInfoRecord |
| B5 | 编辑（CAS version） | PATCH | /api/business-partners/:id | business-partner:edit | 200 / 409 |
| B6 | 软删除（供应商档案/角色/联系人/地址/银行账户/标签/信用/开票资料等**自有子资源级联软删**） | DELETE | /api/business-partners/:id | business-partner:delete | 200 |
| B7 | 被**独立业务事实**引用（customer/opportunity/project 未删除） | DELETE | /api/business-partners/:id | business-partner:delete | 409「往来单位已被客户/商机/项目引用，不能删除（可编辑）」 |
| B8 | 仅存在已软删除的历史草稿引用（deletedAt≠null） | DELETE | /api/business-partners/:id | business-partner:delete | 200（历史草稿不计入引用） |

## Phase 1A detail aggregate contract（锁定）

`GET /api/business-partners/:id` 返回（除主档字段外）必须包含：

- `roles`：BusinessPartnerRole[]（客户/供应商角色，isPrimary 排序）
- `invoiceInfoRecord`：开票资料（ADR-0043）
- `partnerContacts`：联系人（PartnerContact，isPrimary 排序）
- `partnerAddresses`：地址（PartnerAddress，isDefault 排序）
- `partnerTags`：标签（PartnerTag，含 tag 详情）
- `partnerCredit`：信用（PartnerCredit）

> 契约红线：以上为只读聚合，复用 PartnerContact/Address/Tag/Credit 权威模型；禁止复制业务字段、禁止写入旧 Customer SSOT。
