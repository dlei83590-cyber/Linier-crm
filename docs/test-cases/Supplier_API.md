# Supplier API 测试用例（Sprint 3C-2）

> 模块：Supplier Foundation（BusinessPartner 唯一主体 + Partner 级共享）
> 关联：docs/qa/Sprint3C2_QA.md、ADR-0010、API_GUIDELINES.md、ERROR_CODES.md
> 说明：以下用例供自动化测试复用；覆盖 suppliers 主档 + 四类子资源 + Partner 共享资源视图 + BusinessPartnerRole。

## A. 认证与权限

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 suppliers | GET /api/suppliers | 401，`{success:false, error:{code:AUTH_001}}` |
| A2 | MEMBER 无 supplier:create 权限 | POST /api/suppliers | 403，`{success:false, error:{code:AUTH_002}}` |
| A3 | MANAGER 可访问全部 supplier:* 动作 | GET/POST/PATCH/DELETE | 200/201 |
| A4 | 权限码校验 | 每类资源（supplier-qualification 等 10 模块） | 无权限 403 |

## B. Suppliers 主档

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | 创建供应商（partnerId=BP-S-0001，type=SUPPLIER） | POST /api/suppliers | 201，自动写入 BusinessPartnerRole(SUPPLIER) |
| B2 | 创建供应商（partnerId=BP-C-0001，type=CUSTOMER） | POST /api/suppliers | 409 CONFLICT，提示调整 BP 类型 |
| B3 | partnerId 不存在 | POST /api/suppliers | 404 NOT_FOUND |
| B4 | 编码重复 | POST /api/suppliers（同 code） | 409 CONFLICT |
| B5 | 分页+过滤（code/name/status/partnerId/isPreferred） | GET /api/suppliers | 200，meta 含 page/pageSize/total |
| B6 | 详情含 BP 企业字段 + 子资源计数 | GET /api/suppliers/:id | 200，含 partner/qualifications/certificates/settlements |
| B7 | 更新（乐观锁 version 正确） | PATCH /api/suppliers/:id | 200，version+1 |
| B8 | 更新（version 冲突） | PATCH /api/suppliers/:id | 409 VERSION_CONFLICT |
| B9 | 更新 partnerId 到 CUSTOMER 类型 BP | PATCH /api/suppliers/:id | 409 CONFLICT |
| B10 | 软删除（级联子资源标记） | DELETE /api/suppliers/:id | 200 `{deleted:true}`；子表 deletedAt 置位 |
| B11 | 删除后查询 | GET /api/suppliers/:id | 404 |
| B12 | 创建时 BP type=BOTH 允许 | POST /api/suppliers（BP-B-0001） | 201 |

## C. Supplier 独有子资源（Qualification / Certificate / Settlement）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| C1 | 新增资质 | POST /api/suppliers/:id/qualifications | 201 |
| C2 | 资质列表分页 | GET /api/suppliers/:id/qualifications | 200，meta 分页 |
| C3 | 更新资质（乐观锁） | PATCH .../qualifications/:qualId | 200 |
| C4 | 删除资质（软删） | DELETE .../qualifications/:qualId | 200 `{deleted:true}` |
| C5 | 资质属于其他供应商 | PATCH .../qualifications/:qualId（错配 supplierId） | 404 |
| C6 | 新增证书 | POST /api/suppliers/:id/certificates | 201 |
| C7 | 更新/删除证书 | PATCH/DELETE .../certificates/:certId | 200 |
| C8 | 新增结算条款 | POST /api/suppliers/:id/settlements | 201 |
| C9 | 更新/删除结算 | PATCH/DELETE .../settlements/:settlementId | 200 |
| C10 | 供应商不存在时子资源操作 | POST /api/suppliers/nonexistent/qualifications | 404 |

## D. Partner 共享资源（通过 supplier.partnerId 读写共享表）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| D1 | 联系人列表（PartnerContact） | GET /api/suppliers/:id/contacts | 200，数据挂 supplier.partnerId |
| D2 | 新增联系人（isPrimary=true 清除其他主联系人） | POST /api/suppliers/:id/contacts | 201；其他联系人 isPrimary=false |
| D3 | 更新联系人（乐观锁） | PATCH .../contacts/:contactId | 200 |
| D4 | 删除联系人（软删） | DELETE .../contacts/:contactId | 200 |
| D5 | 地址列表（PartnerAddress，含新枚举类型） | GET /api/suppliers/:id/addresses | 200 |
| D6 | 新增地址（addressType=WAREHOUSE；isDefault 唯一） | POST /api/suppliers/:id/addresses | 201；旧默认地址清除 |
| D7 | 标签列表（PartnerTag，含 tag 信息） | GET /api/suppliers/:id/tags | 200 |
| D8 | 打标签；重复标签 | POST /api/suppliers/:id/tags | 201；重复 409 |
| D9 | 移除标签 | DELETE .../tags/:tagId | 200 |
| D10 | 银行账户列表（PartnerBankAccount） | GET /api/suppliers/:id/bank-accounts | 200 |
| D11 | 新增默认银行账户（isDefault 唯一） | POST /api/suppliers/:id/bank-accounts | 201；旧默认清除 |
| D12 | 信用 upsert（PartnerCredit 1:1） | POST /api/suppliers/:id/credit | 201（首建）→ 200（更新） |
| D13 | 信用查询 | GET /api/suppliers/:id/credit | 200 |
| D14 | 共享表与 Customer 复用验证 | 同一 BP 的 customer 与 supplier 查询 contacts | 返回同一份 PartnerContact |

## E. BusinessPartnerRole

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| E1 | 角色列表 | GET /api/business-partners/:id/roles | 200 |
| E2 | 新增角色（LOGISTICS 扩展） | POST /api/business-partners/:id/roles | 201 |
| E3 | 重复角色 | POST /api/business-partners/:id/roles（同 roleType） | 409 CONFLICT |
| E4 | 移除角色（软删） | DELETE /api/business-partners/:id/roles/:roleId | 200 |
| E5 | 创建 Supplier 自动写 SUPPLIER 角色 | POST /api/suppliers → GET roles | 含 SUPPLIER |

## F. 通用规范（API_GUIDELINES）

| # | 用例 | 预期 |
| --- | --- | --- |
| F1 | 统一响应结构 | 成功 `{success,data,meta}`；失败 `{success:false,error:{code,message}}` |
| F2 | Zod 校验失败 | 400，error.code=VALIDATION_001 |
| F3 | requestMeta 审计 | AuditLog 记录 requestId/traceId/ip/device/browser/result |
| F4 | 软删除统一 | 所有 DELETE 置 deletedAt/isActive=false，无物理删除 |
| F5 | 分页上限 | pageSize 超过 MAX_PAGE_SIZE(100) 被钳制 |
