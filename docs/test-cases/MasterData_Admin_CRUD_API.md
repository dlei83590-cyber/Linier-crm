# MasterData_Admin_CRUD_API.md — 测试用例（Pending Pages Completion：7 域 CRUD + 2 引导页）

- 日期：2026-08-18
- 关联：ADR-0029、docs/frontend/contract-cards/pending-pages-completion-gate.md
- 用途：供自动化/回归测试复用；验证事实源 = GitHub CI + 生产 Runtime smoke（CI-First）

## 1. 认证与权限（全部端点通用）

| 用例 | 输入 | 期望 |
|---|---|---|
| AUTH-1 | 无 token 访问任意端点 | 401 AUTHENTICATION_ERROR |
| AUTH-2 | 无权限角色访问（如 MEMBER 调 user:create） | 403 FORBIDDEN |
| AUTH-3 | SUPER_ADMIN 访问全部新端点 | 200/201（权限齐全） |
| ADR28-1 | 静态：新 requirePermission 码 ∈ ALL_ACTION_PERMISSIONS | 通过（department 已注册） |

## 2. /api/business-partners（business-partner:view/create/edit/delete）

| 用例 | 输入 | 期望 |
|---|---|---|
| BP-1 | GET 分页 + code/name/type/region 过滤 | 200 { success, data[], meta } |
| BP-2 | POST { code, name, type:'CUSTOMER' } | 201；approvalStatus=APPROVED |
| BP-3 | POST 重复 code | 409 CONFLICT |
| BP-4 | POST 重复 uscc | 409 CONFLICT |
| BP-5 | POST 缺 code/name | 400 VALIDATION_ERROR |
| BP-6 | GET /{id} | 200 含 roles 摘要 |
| BP-7 | PATCH { version, name } 正确 version | 200 version+1 |
| BP-8 | PATCH 过期 version | 409 VERSION_CONFLICT |
| BP-9 | DELETE /{id} | 200 { id, deleted:true }；再 GET → 404 |
| BP-10 | PATCH 改 code 与他人冲突 | 409 CONFLICT |
| BP-11 | POST/PATCH uscc 非 18 位或含 I/O/S/V/Z | 400 VALIDATION_ERROR（GB 32100-2015） |
| BP-12 | POST/PATCH uscc 小写输入 | 200/201；落库为大写（服务端归一化） |

## 3. /api/technical-standards（technical-standard:*）

| 用例 | 输入 | 期望 |
|---|---|---|
| TS-1 | GET 分页 + code/name/isActive 过滤 | 200 |
| TS-2 | POST { code, name, description } | 201 |
| TS-3 | POST 重复 code | 409 |
| TS-4 | PATCH { version, name } | 200 version+1 |
| TS-5 | DELETE | 200 软删；再 GET → 404 |
| TS-6 | DELETE 已被 ItemStandard 引用（物料已关联该标准） | 409 CONFLICT「已被物料引用，不能删除（可编辑）」 |
| TS-7 | PATCH 空 payload 仅 version | 400 VALIDATION_ERROR（至少一个更新字段） |

## 4. /api/commercial-terms（commercial-term:*）

| 用例 | 输入 | 期望 |
|---|---|---|
| CT-1 | GET 分页 + code/name 过滤 | 200 |
| CT-2 | POST { code, name } | 201 |
| CT-3 | PATCH 过期 version | 409 VERSION_CONFLICT |
| CT-4 | DELETE | 200 软删（无 FK 引用） |

## 5. /api/document-sequences（document-sequence:*）

| 用例 | 输入 | 期望 |
|---|---|---|
| DS-1 | GET 分页 + docType 过滤 | 200 |
| DS-2 | POST { code, name, docType:'SALES_ORDER', prefix:'SO-', padLength:6 } | 201 nextNo=1 |
| DS-3 | POST 非法 docType | 400 VALIDATION_ERROR |
| DS-4 | PATCH 含 nextNo | 200（#151 起 nextNo 可编辑：管理员显式调整/初始化；约束 nextNo ≥ startNo） |
| DS-5 | PATCH { version, padLength } | 200 version+1；nextNo 不变 |
| DS-6 | DELETE | 200 软删 |

## 5.5 /api/price-lists（price-list:view/create/edit/delete）

| 用例 | 输入 | 期望 |
|---|---|---|
| PL-1 | GET 分页 + code/name/status/priceType 过滤 | 200 含 _count.items |
| PL-2 | POST { code, name, priceType:'SALES' } | 201；approvalStatus=APPROVED |
| PL-3 | POST 重复 code | 409 CONFLICT |
| PL-4 | PATCH { version, name } | 200 version+1 |
| PL-5 | PATCH 过期 version | 409 VERSION_CONFLICT |
| PL-6 | DELETE 无引用 | 200 软删 |
| PL-7 | DELETE 已配置 PriceListItem（单价） | 409 CONFLICT「已配置单价/版本或被报价单引用，不能删除（可编辑）」 |
| PL-8 | DELETE 已有 PriceListVersion / 被 QuotationPriceSnapshot 引用 | 409 CONFLICT（同上） |

## 5.6 /api/unit-of-measures（unit-of-measure:view/create/edit/delete）

| 用例 | 输入 | 期望 |
|---|---|---|
| UOM-1 | GET 分页 + code/name/isActive 过滤 | 200（默认 isActive=true） |
| UOM-2 | POST { code, name, symbol } | 201；approvalStatus=APPROVED |
| UOM-3 | POST 重复 code | 409 CONFLICT |
| UOM-4 | GET /{id} | 200 |
| UOM-5 | PATCH { version, name } | 200 version+1 |
| UOM-6 | PATCH 过期 version | 409 VERSION_CONFLICT |
| UOM-7 | PATCH 改 code 与他人冲突 | 409 CONFLICT |
| UOM-8 | DELETE 无引用 | 200 软删 |
| UOM-9 | DELETE 被物料/单据行/UomConversion 引用 | 409 CONFLICT「已被物料/单据/换算引用，不能删除（可编辑）」 |

## 6. /api/users（user:view/create/edit/delete）

| 用例 | 输入 | 期望 |
|---|---|---|
| USR-1 | GET 分页 + email/departmentId/isActive 过滤 | 200；响应**不含 passwordHash** |
| USR-2 | POST { email, password, roleIds } | 201；DB 中 passwordHash 为 bcrypt（非明文） |
| USR-3 | POST 重复 email | 409 CONFLICT |
| USR-4 | POST 密码 <6 位 | 400 VALIDATION_ERROR |
| USR-5 | POST roleIds 含无效 id | 400 VALIDATION_ERROR |
| USR-6 | PATCH { isActive:false } | 200；用户停用（登录被拒） |
| USR-7 | PATCH { roleIds: [] } | 200；角色清空 |
| USR-8 | PATCH { password } | 200；新密码可登录 |
| USR-9 | DELETE /{id} | 200 { id, deactivated:true }；isActive=false（非物理删除） |
| USR-10 | PATCH departmentId 指向不存在部门 | 409 NOT_FOUND |
| USR-11 | 角色列展示（SUPER_ADMIN/ADMIN 等） | 中文名（超级管理员/管理员…，labels.ts ROLE_LABELS） |

## 7. /api/departments（department:view/create/edit；无 DELETE）

| 用例 | 输入 | 期望 |
|---|---|---|
| DEP-1 | GET 分页 + code/name/parentId 过滤 | 200 含 parent/_count |
| DEP-2 | POST { code, name, parentId } | 201 |
| DEP-3 | POST 重复 code | 409 |
| DEP-4 | POST parentId 不存在 | 409 NOT_FOUND |
| DEP-5 | PATCH { parentId: 自身 id } | 409 CONFLICT（循环引用） |
| DEP-6 | PATCH { parentId: 子孙 id } | 409 CONFLICT（循环引用） |
| DEP-7 | PATCH { name } | 200 |
| DEP-8 | DELETE | 405/404（无 DELETE 端点） |

## 8. /api/roles（role:view/create/edit；无 DELETE）

| 用例 | 输入 | 期望 |
|---|---|---|
| ROL-1 | GET 分页 + code/name 过滤 | 200 含 _count.permissions/users |
| ROL-2 | POST { code:'OPERATOR', name } | 201 |
| ROL-3 | POST 小写 code | 400（正则 ^[A-Z][A-Z0-9_]*$） |
| ROL-4 | POST 重复 code | 409 |
| ROL-5 | POST permissionCodes 含未知 code | 400 VALIDATION_ERROR |
| ROL-6 | PATCH { permissionCodes:[...] } | 200；权限集合被替换（set 语义） |
| ROL-7 | GET /{id} | 200 含 permissions 全量 code（module 分组可展示） |
| ROL-8 | DELETE | 405/404（无 DELETE 端点） |
| ROL-9 | 权限展示（roles 编辑页） | 中文（物料 · 查看，labels.ts moduleLabel/permissionLabel） |

## 8.5 /api/ap-open-items（ap-open-item:view，只读）

| 用例 | 输入 | 期望 |
|---|---|---|
| APO-1 | GET 分页 + settlementStatus=UNPAID 过滤 | 200 { success, data[], meta }；UNPAID 在前 |
| APO-2 | GET supplierId 过滤 | 200 仅该供应商 Open Items |
| APO-3 | GET dueDateFrom/dueDateTo | 200 到期日范围过滤 |
| APO-4 | POST/PATCH/DELETE | 405（无写端点） |
| APO-5 | 无 ap-open-item:view 角色（MANAGER） | 403 FORBIDDEN |
| APO-6 | 响应字段 | openAmount 为 Decimal 字符串（服务端投影），不含客户端计算 |

## 9. 前端页面（生产 Runtime smoke）

| 用例 | 路径 | 期望 |
|---|---|---|
| UI-1 | /business-partners + /new + /[id]/edit | 列表/新建/编辑可用；无权限 403 |
| UI-2 | /technical-standards + /new + /[id]/edit | 同上；列表含编辑/删除行操作 |
| UI-3 | /commercial-terms + /new + /[id]/edit | 同上；列表含编辑/删除行操作 |
| UI-3b | /price-lists + /new + /[id]/edit | 同上；列表含编辑/删除行操作 |
| UI-3c | /unit-of-measures + /new + /[id]/edit | 新建/编辑/删除行操作（此前仅只读列表） |
| UI-4 | /document-sequences + /new + /[id]/edit | 同上；nextNo 只读展示 |
| UI-5 | /users + /new + /[id]/edit | 角色多选、密码字段、停用 |
| UI-6 | /departments + /new + /[id]/edit | parent 列/选择；自身排除 |
| UI-7 | /roles + /new + /[id]/edit | 权限只读分组展示 |
| UI-8 | /project-visits、/project-risks | 引导页 + 跳转 /projects |

## 10. 回归（既有模块不受影响）

- items / price-lists / unit-of-measures / warehouses 列表页回归（registry 改动不破坏导航）
- 登录/会话（auth）回归：USER_READ 等旧权限码未改（向后兼容）
- 项目详情风险/走访 Tab 回归（B2-1B 无改动）