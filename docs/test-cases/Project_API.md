# Project API 测试用例（Sprint 3C-5 Project Foundation）

> 模块：Project Foundation（Opportunity / Project 主档 + convert / transition / close + 12 子资源）
> 关联：docs/qa/Sprint3C5_QA.md、ADR-0014、API_GUIDELINES.md、ERROR_CODES.md
> 说明：覆盖 16 路由（34 文件）；重点覆盖 CTO 指定场景：重复转换、事务原子性、非法阶段跳转、结项检查、强制结项、价格快照、重复 Tag、结项后禁改。

## A. 认证与权限

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 | GET /api/projects | 401 AUTHENTICATION_ERROR |
| A2 | MEMBER 无 project-stakeholder:create | POST /api/projects/:id/stakeholders | 403 FORBIDDEN |
| A3 | 强制结项无 project:approve | POST /api/projects/:id/close {force:true} | 403 |
| A4 | 权限码覆盖 16 模块 | project-opportunity/project + 12 子资源 + tag/attachment | 无权限 403 |

## B. Project Opportunities（/api/project-opportunities）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | 创建机会（code/name/customerId） | POST | 201，默认 stage=LEAD |
| B2 | code 重复 | POST | 409 CONFLICT |
| B3 | customerId 不存在 | POST | 404 |
| B4 | 列表过滤 code/name/stage/customerId/ownerId | GET | 200 分页 |
| B5 | 详情含 customer/project | GET /:id | 200 |
| B6 | 更新（乐观锁） | PATCH | 200 version+1 |
| B7 | 更新 version 冲突 | PATCH | 409 VERSION_CONFLICT |
| B8 | 已转换机会改关键字段 | PATCH（convertedAt 非空） | 409 |
| B9 | 软删除 | DELETE | 200 `{deleted:true}` |
| B10 | 已转换机会删除 | DELETE | 409 |

## C. Convert（唯一入口 POST /api/project-opportunities/:id/convert）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| C1 | 转换成功（事务） | POST /convert | 200，返回 Project（code 由 DocumentSequence 生成，PJ 前缀） |
| C2 | 复制客户/财务/负责人/描述 | 转换后检查 | Project 字段与 Opportunity 一致 |
| C3 | 回写 convertedAt/convertedBy | 转换后查 Opportunity | 非空 |
| C4 | 重复转换 | 二次 POST /convert | 409 |
| C5 | 机会不存在 | POST /convert（无效 id） | 404 |
| C6 | 事务原子性 | 注入失败（如 DocumentSequence 异常） | 无半成品 Project |
| C7 | 禁止普通 POST /projects 模拟 | POST /projects（带 opportunityId） | 不开放 opportunityId 字段，仅 convert 可建 |

## D. Projects 主档（/api/projects）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| D1 | 创建项目（code/name/customerId） | POST | 201，默认 stage=SAMPLING |
| D2 | code 重复 | POST | 409 |
| D3 | 列表过滤 + 子资源计数 | GET | 200（members/tasks/risks 计数） |
| D4 | 详情含全部子资源 + tags + closure | GET /:id | 200 |
| D5 | 更新 priority/progressPercent（乐观锁） | PATCH | 200 |
| D6 | PATCH 不开放 stage | PATCH（stage 字段） | zod 忽略/400（禁止 PATCH 改 stage） |
| D7 | 结项后 PATCH 关键字段 | PATCH（已 close） | 409 |
| D8 | 软删除；已结项删除 | DELETE | 200 / 409 |

## E. Transition（POST /api/projects/:id/transition）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| E1 | 正向推进（QUOTATION→SAMPLING） | POST {targetStage:"SAMPLING", version} | 200 |
| E2 | 任意→PAUSED/FAILED | POST | 200 |
| E3 | MASS_SUPPLY→CLOSED | POST | 200 |
| E4 | 跳级（LEAD→SAMPLING） | POST | 409 |
| E5 | 倒退（MASS_SUPPLY→SAMPLING） | POST | 409 |
| E6 | 非法目标（CLOSED 从 LEAD） | POST | 409 |
| E7 | 旧 version | POST | 409 VERSION_CONFLICT |
| E8 | 流转写 AuditLog | 检查 audit-logs | beforeStage/afterStage 记录 |

## F. Close（POST /api/projects/:id/close）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| F1 | 正常结项（任务完成/风险关闭/已验收/回款完成） | POST {reason, version} | 200，stage=CLOSED |
| F2 | 存在未完成任务 | POST（force 缺省） | 409 |
| F3 | 存在未关闭风险 | POST | 409 |
| F4 | 尚未验收 | POST | 409 |
| F5 | 有应收余额/未回款 | POST | 409 |
| F6 | force=true 无 reason | POST | 400 |
| F7 | force=true 无 project:approve | POST | 403 |
| F8 | force=true + 双权限 + reason | POST {force:true, reason, version} | 200；Closure + ProjectProgress(100%) + AuditLog 落库 |
| F9 | 已结项再次 close | POST | 409 |
| F10 | 旧 version | POST | 409 |

## G. 子资源 CRUD（stakeholders/members/milestones/tasks/budgets/expenses/products/risks/visits/progress/acceptance/closure/tags/attachments）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| G1 | 各子资源列表分页/过滤 | GET /api/projects/:id/* | 200 |
| G2 | 各子资源创建/更新/删除（乐观锁） | POST/PATCH/DELETE | 201/200/200 |
| G3 | members 与 stakeholders 隔离 | 各自 API/权限 | 独立 |
| G4 | products 引用 itemId + priceSnapshotId | POST /products | 201；快照引用完整定价链 |
| G5 | products priceSnapshotId 不存在 | POST | 404 |
| G6 | progress 写入同步 Project.progressPercent | POST /progress | Project.progressPercent 更新 |
| G7 | tags 复用全局 Tag（重复绑定） | POST /tags（重复 projectId+tagId） | 409 |
| G8 | tags 绑定不存在 Tag | POST /tags | 404 |
| G9 | attachments 复用 File Center | POST /attachments（fileId） | 201，businessType="project" |
| G10 | attachments file 不存在 | POST | 404 |
| G11 | closure 详情（1:1） | GET /closure | 200 / 404（未结项） |

## H. 金额与时间规范（架构红线）

| # | 用例 | 验证 |
| --- | --- | --- |
| H1 | 金额字段 Decimal | Project 财务字段 @db.Decimal，无 Float |
| H2 | 价格一律 resolvePrice | ProjectProduct 无手工价格字段；仅快照引用 |
| H3 | 附件一律 File Center | attachments 全部走 FileAttachment |
| H4 | 状态变化写 Workflow/Audit | transition/close/convert 均写 AuditLog |
