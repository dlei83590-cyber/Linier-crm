# Customer API 测试用例（3C-1 Customer Foundation）

> ⚠️ **LEGACY / DEPRECATED — ADR-0051**（2026-08-24）
> Customer 模型已判定 DEPRECATE：业务事实全部由 BusinessPartner 承载；/api/customers 保留兼容窗口，**禁止新 CRM 功能继续使用**。新开发一律走 /api/business-partners（见 BusinessPartner_API.md）。

> Sprint 3C-1 ｜分支：feature/sprint3-business-foundation
> 用途：自动化测试复用基准，与 docs/qa/Sprint3C1_QA.md 配套

## 范围

- Customer 主档 CRUD + CustomerContact/CustomerAddress/CustomerTag/CustomerCredit 子资源
- Industry / Tag 字典 CRUD

## 用例

| # | 场景 | 方法 | 路径 | 权限 | 预期 |
| --- | --- | --- | --- | --- | --- |
| C1 | 客户列表（分页+过滤） | GET | /api/customers?page=1&pageSize=20&name=xx | customer:view | 200 + meta |
| C2 | 创建客户 | POST | /api/customers | customer:create | 201 |
| C3 | 重复 code 创建 | POST | /api/customers（同 code） | customer:create | 409 |
| C4 | 客户详情（含子资源） | GET | /api/customers/:id | customer:view | 200 |
| C5 | 更新客户（乐观锁） | PATCH | /api/customers/:id（旧 version） | customer:edit | 409 |
| C6 | 软删除客户 | DELETE | /api/customers/:id | customer:delete | 200 |
| C7 | 创建联系人 | POST | /api/customers/:id/contacts | customer-contact:create | 201 |
| C8 | 主联系人唯一性 | POST | 第二个 isPrimary=true | customer-contact:create | 前者自动转 false |
| C9 | 创建地址 | POST | /api/customers/:id/addresses | customer-address:create | 201 |
| C10 | 默认地址唯一性 | POST | 第二个 isDefault=true | customer-address:create | 前者自动转 false |
| C11 | 打标签（tagId） | POST | /api/customers/:id/tags | customer-tag:create | 201 |
| C12 | 重复标签 | POST | 同 tagId 再打 | customer-tag:create | 409 |
| C13 | 移除标签 | DELETE | /api/customers/:id/tags/:tagId | customer-tag:delete | 200 |
| C14 | 创建信用 | POST | /api/customers/:id/credit | customer-credit:create | 201 |
| C15 | 更新信用（upsert） | POST | /api/customers/:id/credit | customer-credit:create | 200 |
| C16 | 行业列表/创建 | GET/POST | /api/industries | industry:view/create | 200/201 |
| C17 | 行业重复 code | POST | /api/industries（同 code） | industry:create | 409 |
| C18 | 标签列表/创建 | GET/POST | /api/tags | tag:view/create | 200/201 |
| C19 | 无权限访问 | GET | /api/customers | 无权限角色 | 403 |
| C20 | 未认证访问 | GET | /api/customers | 无 token | 401 |
| C21 | 客户不存在 | GET | /api/customers/:fakeId | customer:view | 404 |

## 验收

- [ ] 全部用例通过
- [ ] 业务规则（主联系人/默认地址唯一性、重复标签、信用 upsert）验证通过
- [ ] CTO 审核
