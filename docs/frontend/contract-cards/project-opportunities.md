# Contract Card — 项目机会

- 模块：`project-opportunities`（客户与项目 · 项目机会）
- 判定：**已开放（CRUD Ready）**（Backend FINAL + Frontend List/Detail/Create/Edit/Delete 已交付）
- 归属 Wave：F2-4（F2-4A1 List/Detail + F2-4A2 Create/Edit 完成；Tier 2/3 待后续）
- Backend Contract：list / detail / create / edit / ~workflow / factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：list ✅ / detail ✅ / create ✅ / edit ✅ / delete ✅（列表行操作「删除」，2026-09-27）/ workflow HOLD / factActions HOLD（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD；Convert 唯一入口已开放——FRT-05 详情页「转为项目」→ POST /convert；Edit 支持清空 nullable 商业预测字段——blank 持久化为 null）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                      | 方法   | 说明               |
| ------- | ----------------------------------------- | ------ | ------------------ |
| List    | `/api/project-opportunities`              | GET    | 分页/筛选          |
| Detail  | `/api/project-opportunities/{id}`         | GET    | —                  |
| Create  | `/api/project-opportunities`              | POST   | —                  |
| Edit    | `/api/project-opportunities/{id}`         | PATCH  | CAS version        |
| Delete  | `/api/project-opportunities/{id}`         | DELETE | —                  |
| Actions | `/api/project-opportunities/{id}/convert` | POST   | 转项目（事实动作） |

## Permission

- `project-opportunity:view` / `:create` / `:edit` / `:delete`（动作级权限已 seed；前端按会话有效权限集判定，ADR-0057）

## Status Machine

- 机会阶段流转（以 OpenAPI 为准，前端只做映射表）

## Selectors

- Customer（`/api/customers`，GET FINAL）
- Item / UOM（如产品线字段需要）

## Error Codes

- 409：version 冲突 / 状态不允许 convert / **已转换为项目禁止删除**（DELETE，保持项目溯源）

## Frontend Current State（ui 层事实，2026-09-27 校对）

| 能力              | 状态                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| List              | ✅ 已开放（/project-opportunities：筛选 code/name/stage + 分页 + URL 同步 + 行操作 详情/编辑/删除）          |
| Detail            | ✅ 已开放（/project-opportunities/{id}：Header Summary + 状态徽标 + 关联报价只读投影）                      |
| Create            | ✅ 已开放（/project-opportunities/new；客户选择器 = /api/business-partners?type=CUSTOMER，P0-1 SSOT）        |
| Edit              | ✅ 已开放（/project-opportunities/{id}/edit）                                                               |
| Delete            | ✅ 已开放（列表行「删除」+ ConfirmActionDialog 二次确认；权限 project-opportunity:delete；已转换为项目 → 服务端 409，前端展示真实错误） |
| Submit / Workflow | HOLD（Tier 2 HARD HOLD）                                                                                    |
| Fact Actions      | Convert ✅ 已开放（FRT-05 详情页「转为项目」→ POST /api/project-opportunities/:id/convert）；其余 HOLD（Tier 3） |

## Current UI

- 列表页 /project-opportunities（行操作：详情 / 编辑 / 删除）
- 详情页 /project-opportunities/{id}（转为项目 / 创建报价 / 编辑 + 相关报价只读区块）
- 新建 / 编辑表单（客户选择器复用往来单位 CUSTOMER 数据源）

## Gap

- Workflow（提交/审批）与 Tier 3 其余事实动作仍 HOLD
- **删除红线**：已转换为项目的机会保持不可删除（服务端 409 含引用出处：「机会「XX」已被引用，不能删除：已转项目 1 条（PJ-XXXX）」，项目溯源不变量；文案随问题二统一为引用出处格式）
