# ERROR_CODES 错误码注册表

- 版本：v1.1
- 日期：2026-08-12
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：[API_GUIDELINES.md](./API_GUIDELINES.md) ｜ `apps/web/src/lib/api/errors.ts`（ERROR_CODES 常量）

> **规则**：所有 API 错误码必须在此注册，禁止散落魔法字符串。
> 编码规则：`{DOMAIN}_{SEQ}`（如 AUTH_001），全局唯一，新增需追加并保持向后兼容。
> 前端按 code 国际化；日志按 code 统计；Sprint 4 前完成全局 Error Code Registry 落地。

## 1. 通用（COMMON）

| code | HTTP | 说明 |
| --- | --- | --- |
| COMMON_001 | 400 | 请求参数校验失败（Zod） |
| COMMON_002 | 401 | 未认证（缺少/无效令牌） |
| COMMON_003 | 403 | 无权限 |
| COMMON_004 | 404 | 资源不存在 |
| COMMON_005 | 409 | 资源冲突（重复/状态不允许） |
| COMMON_006 | 409 | 乐观锁版本冲突（VERSION_CONFLICT） |
| COMMON_007 | 500 | 服务器内部错误 |
| COMMON_008 | 429 | 请求过于频繁（限流） |

## 2. 认证授权（AUTH）

| code | HTTP | 说明 |
| --- | --- | --- |
| AUTH_001 | 401 | 邮箱或密码错误 |
| AUTH_002 | 401 | 账号已停用 |
| AUTH_003 | 401 | 令牌过期 |
| AUTH_004 | 401 | 令牌无效 |
| AUTH_005 | 403 | 角色无权访问该资源 |

## 3. 主数据（ITEM / PARTNER / PRICE）

| code | HTTP | 说明 |
| --- | --- | --- |
| ITEM_001 | 404 | 物料不存在 |
| ITEM_002 | 409 | 物料编码已存在 |
| ITEM_003 | 409 | 物料状态不允许该操作 |
| PARTNER_001 | 404 | 往来单位不存在 |
| PARTNER_002 | 409 | 统一社会信用代码已存在 |
| PARTNER_003 | 409 | 往来单位被业务单据引用，禁止删除 |
| PRICE_001 | 404 | 价格表不存在 |
| PRICE_002 | 409 | 价格表编码已存在 |
| PRICE_003 | 409 | 价格行物料+价格类型重复 |

## 4. 项目领域（PROJECT）

| code | HTTP | 说明 |
| --- | --- | --- |
| PROJECT_001 | 404 | 项目/机会不存在 |
| PROJECT_002 | 409 | 机会编号已存在 |
| PROJECT_003 | 409 | 项目已结项，禁止修改 |
| PROJECT_004 | 409 | 机会已关联项目，禁止重复建档 |

## 5. 工作流（WORKFLOW）

| code | HTTP | 说明 |
| --- | --- | --- |
| WORKFLOW_001 | 404 | 工作流定义不存在 |
| WORKFLOW_002 | 409 | 工作流编码已存在 |
| WORKFLOW_003 | 409 | 已发布/归档，禁止修改关键结构 |
| WORKFLOW_004 | 409 | 工作流至少需要一个步骤才能发布 |
| WORKFLOW_005 | 404 | 审批实例不存在 |
| WORKFLOW_006 | 409 | 该业务单据已存在审批实例 |
| WORKFLOW_007 | 409 | 审批已结束，仅可评论 |
| WORKFLOW_008 | 400 | 无效的工作流动作 |
| WORKFLOW_009 | 403 | 无当前步骤待办权限 |
| WORKFLOW_010 | 403 | 仅发起人可撤销 |
| WORKFLOW_011 | 400 | 转交/委托必须指定目标用户 |

## 6. 平台配置（SETTING / DICT / NOTIFY / APPROVER）

| code | HTTP | 说明 |
| --- | --- | --- |
| SETTING_001 | 404 | 设置项不存在 |
| SETTING_002 | 409 | 设置键已存在 |
| DICT_001 | 404 | 字典类型不存在 |
| DICT_002 | 409 | 字典类型编码已存在 |
| DICT_003 | 404 | 字典项不存在 |
| DICT_004 | 409 | 字典项编码已存在 |
| NOTIFY_001 | 404 | 通知模板不存在 |
| NOTIFY_002 | 409 | 通知模板编码已存在 |
| APPROVER_001 | 404 | 审批组不存在 |
| APPROVER_002 | 409 | 审批组编码已存在 |

## 7. 平台能力（MENU / DASHBOARD / FILE / AUDIT）

| code | HTTP | 说明 |
| --- | --- | --- |
| MENU_001 | 404 | 菜单/菜单组不存在 |
| MENU_002 | 409 | 菜单编码已存在 |
| MENU_003 | 409 | 父菜单不能是自身 |
| DASHBOARD_001 | 404 | Dashboard 组件（widget/layout/kpi/chart）不存在 |
| DASHBOARD_002 | 409 | Dashboard 组件编码已存在 |
| FILE_001 | 404 | 文件/文件夹/版本不存在 |
| FILE_002 | 409 | 文件编码已存在 |
| FILE_003 | 409 | 文件已挂载到同一业务单据 |
| FILE_004 | 413 | 文件超过大小限制 |
| AUDIT_001 | 403 | 无审计日志查看权限（仅 SUPER_ADMIN/ADMIN） |

## 8. 采购供应链（SUPPLIER_INVOICE）——Sprint 5C-1C Supplier Invoice POST / GRIR CONSUME / AP Liability-OpenItem

> 注册范围：POST 端点（`/api/supplier-invoices/{id}/post`）实际使用码（CTO #9678 六条不变量 + #9757/#9781 精确更新 + 2026-08-12 B1/P2002 收紧）。
> 命名与 `apps/web/src/lib/api/errors.ts` ERROR_CODES 常量一致（描述性名，非旧式 `{DOMAIN}_{SEQ}`）。
> P2002 分类：Phase B 内唯一约束冲突仅在确认 Invoice=POSTED 时返回 ALREADY_POSTED；否则为 invariant conflict（500）——不伪装成已过账。

| code | HTTP | 说明 |
| --- | --- | --- |
| SUPPLIER_INVOICE_NOT_FOUND | 404 | 供应商发票不存在 |
| SUPPLIER_INVOICE_NO_LINES | 400 | 发票至少需要一条有效行 |
| SUPPLIER_INVOICE_WHR_NOT_POSTED | 400 | 入库行所属 WHR 必须已 POSTED（来源事实重验） |
| SUPPLIER_INVOICE_SOURCE_CHAIN_MISMATCH | 400 | WHR Line ↔ PO Line ↔ Item ↔ Supplier 来源链不一致 |
| SUPPLIER_INVOICE_ITEM_INVALID | 400 | 物料不存在/已停用（来源事实重验） |
| SUPPLIER_INVOICE_QUANTITY_INVALID | 400 | 开票数量必须 > 0 且 ≤ 已入库数量 |
| SUPPLIER_INVOICE_CUMULATIVE_QTY_EXCEEDED | 400 | 累计开票数量超过已入库数量（含其他发票占用） |
| SUPPLIER_INVOICE_NOT_APPROVED | 409 | 仅 APPROVED 状态可过账（APPROVED ≠ POSTED） |
| SUPPLIER_INVOICE_ALREADY_POSTED | 409 | 仅确认 Invoice=POSTED 时返回：幂等拒绝，不重复生成 Liability/Consume |
| SUPPLIER_INVOICE_APPROVAL_SNAPSHOT_INVALID | 409 | 审批快照引用（approvedMatchRunId/Revision）缺失或与审批 immutable snapshot 不一致 |
| SUPPLIER_INVOICE_MAKER_CHECKER | 409 | maker-checker：过账人不得 = 创建人/审批人 |
| SUPPLIER_INVOICE_GRIR_INSUFFICIENT | 409 | 剩余 GRIR 不足以全额消耗（禁止 partial POST，fail closed） |
| VERSION_CONFLICT | 409 | POST 终态 CAS 失败（事务回滚，Invoice 保持 APPROVED；B1 throw 映射） |

## 9. 注册规则

1. 新错误码：`{DOMAIN}_{三位序号}`，追加到对应域表格
2. 同步更新 `apps/web/src/lib/api/errors.ts` 的 `ERROR_CODES` 常量
3. 前端国际化文件按 code 提供文案（预留 i18n 目录）
4. 删除/修改已发布错误码属于 Breaking Change，必须走版本升级（ADR）

## 10. 变更记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-12 | v1.1 | 新增「采购供应链（SUPPLIER_INVOICE）」段（Sprint 5C-1C POST 端点实际使用码 + B1/P2002 分类语义） |
| 2026-08-05 | v1.0 | 初始注册（通用/认证/主数据/项目/工作流/平台配置/平台能力） |
