# CTO 仓库巡检与项目优化审计报告

- **日期：** 2026-08-20
- **审计人：** CTO（AI Agent 代理执行，GitHub CLI 连接 dlei83590-cyber/Linier-crm）
- **范围：** 仓库巡检（Phase A）· 项目分析优化 · 分支整理 · 中国环境字段/逻辑对齐 · 下一开发项规划
- **方法：** 只读静态审计（docs/ROADMAP/CTO Directive/ADR/Schema/API/CI/分支/发布），未启动本地服务器、未运行本地高负载验证；验证事实源 = GitHub CI 与 GitHub API。
- **审计证据：** 全仓 220 份文档、prisma/schema.prisma 174 model / 108 enum（6223 行）、36 个 migration、295 个 API route、CI run #537-#546、62 个远程分支逐支 merged-PR 核验、v0.1.0~v0.8.0-alpha 发布记录。

---

## 1. 总体事实基线（2026-08-20）

| 维度 | 事实 |
| --- | --- |
| 当前版本 | RELEASE_VERSION manifest = **v0.8.0-alpha**（2026-08-19 发布）；main HEAD = `6491113`（v0.8.0 之后 54 commits） |
| ROADMAP | v1.25（2026-08-20 最新日志条目，头部版本号未同步为 v1.25） |
| Sprint 状态 | Sprint 1-6 ✅ Closed；Sprint 5C-2 ✅（CTO 2026-08-19 解锁）；Sprint 7 Finance 🔄 部分（GL 已落地 ADR-0033~0037 + 库存成本 ADR-0038~0041，**单币种 CNY 决策 2026-08-20**）；Sprint 8 BI ⬜ |
| Migration | 0001–0036（生产 baseline 0028；0033-0036 = GL/成本） |
| CI | workflow CI + Release 均 active；main 最近 10 个 push run：**#546（6491113）= ✅ success**，#545 曾失败已由 6491113 修复；累计 545+ 次运行 |
| 分支 | 巡检前：远程 62 个分支（49 merged + 若干 squash-merged 误判 + 1 个未合并已关闭）＋本地 9 个；巡检后：**仅 main** |
| 无开放 PR | ✅ 0 个 open PR |
| main 保护 | ❌ **无分支保护**（API 404 "Branch not protected"）——任何人可直接 push main |

## 2. 治理发现

| 优先级 | 发现 | 证据 | 处置 |
| --- | --- | --- | --- |
| **P0** | main 无分支保护：CI GREEN 靠自律而非强制；直接 push 可绕过 Quality/Build/Secret Scanning | branches/main/protection → 404 | **建议启用分支保护**：require PR + 必过 CI（quality/build/security）+ 线性历史 + 直接 push 禁止（需 CTO 拍板执行） |
| **P1** | 工作区 AGENTS.md（2026-08-19 最后提交）§3 与 ROADMAP v1.25 严重漂移：仍写 5C-2 HOLD / GL HOLD / 下一项=v0.7.0 Release Gate；实际 5C-2 ✅、GL 部分 ✅、成本 ADR-0038~0041 ✅、v0.8.0 已发布 | AGENTS.md a9aac28 vs ROADMAP v1.25 | **建议同步 AGENTS.md §3**（本审计已列具体修改点） |
| **P1** | ROADMAP 头部 v1.24 与日志 v1.25 不一致；v1.25 未记录 ADR-0038~0041（成本核算）与 2026-08-20 UI 批次 | ROADMAP L3 vs L286 | 建议升 v1.26 记录成本/UI/本审计 |
| **P1** | v0.8.0-alpha GitHub Release 正文为空；`docs/releases/v0.8.0-alpha.md` 缺失（仅 v0.1.0/v0.7.0）——release.yml `fail_on_unmatched_files: true` 因缺 body 文件而空发布 | release view body=""；docs/releases/ 目录 | ✅ **本审计已修复**：补 notes 文件 + gh release edit 正文 |
| **P2** | .env.example `NEXT_PUBLIC_RELEASE_VERSION` 停在 v0.6.0-alpha（SSOT 为 v0.8.0-alpha） | .env.example L23 | ✅ **本审计已修复** |
| **P2** | 版本号五处漂移：root package.json 0.2.0-alpha ≠ RELEASE_VERSION v0.8.0-alpha ≠ .env.example（已修）≠ openapi 0.3.0-alpha ≠ config/app.ts 0.1.0 | 各文件 | 建议收敛到 RELEASE_VERSION SSOT（P0.5 部分落地） |
| **P2** | CI 中 `NEXT_PUBLIC_GIT_SHA/BUILD_ID/DEPLOYMENT_ENV` 注释原为 UTF-8 中文，Windows PowerShell 5.1 默认 ANSI 读取显示乱码——**文件本身为干净 UTF-8，非缺陷** | 复测 -Encoding UTF8 正常 | 无需动作（仅记录读取工具习惯） |

## 3. 中国环境对齐审计（子代理深度审计，schema 全量 6223 行 + 字段矩阵 + ADR-0033~0041）

**总评：78/100** —— 数据架构与业务事实纪律优秀（事实/投影分离、服务端 Decimal 权威、GRIR 全生命周期、三单 immutable Match、移动加权平均、期末结转本年利润、uscc 唯一、价税分离、maker-checker 均与用友/金蝶实务吻合）。

**P0 — 销售侧 GL 闭环缺失（利润表失真）**：GL consumer 只注册 6 类采购/库存事件（`lib/domain-events/consumer.ts` L27-34）；Invoice ISSUE / 收款核销不产生凭证 → 无 1122 应收账款、无 6001 主营业务收入、无销项税额科目；试算平衡表与利润表只反映采购侧+COGS。**EVENTS 已有 InvoiceIssued/ReceiptAllocated 载荷，接口齐备，只差 GL consumer 注册与科目 seed。**

**P1 — 增值税发票管理字段缺失**：无发票类型（专票/普票/数电票）、无发票代码/号码（国标 12+8 / 数电票 20 位）、无红字发票实体；开票信息为自由 Json（BusinessPartner.invoiceInfo）、uscc 无 18 位 DB CHECK、taxpayerType 自由文本。

**P1 — 会计期间体系缺失**：无 AccountingPeriod 模型；GlPeriodClose 仅防重复月结；凭证 postingDate 无期间校验（可过账到已关闭/未来期间）；凭证无凭证字（记/收/付/转）；凭证号不按月重排。

**P1 — 中国结算方式缺失**：PaymentMethod 无银行/商业承兑汇票、电汇；SupplierSettlement.paymentMethod 为自由文本（TT/LC 国际贸易习惯）。

**P1 — 发票价差无科目承接**：暂估入库 vs 发票净额差异无"材料成本差异"科目，存货成本与 AP 口径漂移。

**P1 — 单据编号无按期规则**：DocumentSequence 仅静态 prefix+nextNo，无 {YYYY}{MM} 前缀与按月重置。

**P2 清单**：凭证字/附件张数缺失；seed 科目集最小（缺 1122/6001/销项税/成本类）；222101 进项税 direction 元数据与实务相反；TaxRateType 缺 9%；销售 Invoice 旧 helper 违反 fail-closed（Sequence 缺失返回常量 INV000001）；部分状态裸 String；跨域金额精度 (18,4)/(18,2) 不一致；跨月无边界校验；预付/预收无专项模型；辅助核算（部门/项目/客户维度）缺失。

**中国特有业务缺失（上线前缺口）**：增值税发票管理闭环、销售侧财务记账、会计期间体系、应收应付期初余额、材料成本差异、预付/预收对账、结算方式扩展、辅助核算、出纳与银行对账、成本核算深化（多数为已声明 Gate 边界）。

## 4. 代码质量与架构审计（子代理深度审计，562 文件 / 80k 行 apps/web 全读）

**架构事实**：apps/web 单体（295 route.ts + 127 页面 + 105 lib），packages 4 个为"薄壳"（shared 主体是 RBAC 静态目录 558 行）；分层 route→lib 领域服务→Prisma；关键财务/库存路径并发锁（FOR UPDATE 207 处）、幂等、maker-checker、Outbox（ADR-0031）均教科书级；RBAC 静态目录 + check-rbac-catalog.mjs CI Gate（ADR-0028）是全仓治理亮点；`any`/TODO/@ts-ignore 近清零。

| 优先级 | 发现 | 位置 | 建议 |
| --- | --- | --- | --- |
| **P1** | 错误码文档-代码严重漂移：errors.ts 251 个描述性码 vs ERROR_CODES.md v1.1 仅约 60 个旧式 {DOMAIN}_{SEQ} 码 | docs/ERROR_CODES.md vs lib/api/errors.ts | 自动生成注册表 + CI gate（复用 check-rbac-catalog 模式） |
| **P1** | CRUD 乐观锁非原子（TOCTOU）：126 处 `version: {increment:1}`，0 处 updateMany+where version | 全仓 PATCH 路由 | 改 `updateMany({where:{id,version}})` + count===0→409，优先财务相关 |
| **P1** | GL dateTo 时区日边界错误：`dateTo + 'T23:59:59.999Z'` 把业务日当 UTC，东八区查询漏当天 00:00-08:00 | api/gl/journal-entries/route.ts | 统一时区策略（TZ=Asia/Shanghai，DB 存 UTC，封装业务日工具） |
| **P1** | 财务链路（SINV match/post、GL、付款核销）无路由级/集成级自动化测试（仅 13 个纯函数单测 154 用例；26 份 test-cases 文档无强制对应） | apps/web/src/lib tests | 优先补 5C/GL 路由级 vitest 集成测试 |
| **P1** | JWT 存 localStorage（linier_crm_token），XSS 可窃取会话 | lib/auth-token.ts | httpOnly Secure SameSite cookie + CSRF；至少加 CSP |
| **P2** | string-thrown 控制流（GL PATCH 未知错误映射 409=500）；审计日志事务外写静默吞错；事件投递不一致（PO/Receipt/Invoice 仍 AuditLog-only）；authenticate 每请求查库无缓存；约 80+ 处裸 console.error vs 17 处 handleServerError；无限流实现（API_GUIDELINES §10 声明未落地）；purchase-orders confirm `supplierCode: po.supplier?.id` 语义错位；分页双实现 | 各处 route/lib | 按收益/成本排序收敛（见 §6） |
| **P3** | gitleaks allowlist 仅 1 条；docker-compose 默认口令未列入；test:e2e 空脚本（无 playwright.config/e2e 目录） | 工程配置 | 记录级 |

## 5. 已执行动作（本审计）

1. ✅ **分支整理**：远程 62 个分支逐支核验 merged PR 后全部删除（含 squash-merge 误判的 6 个与 project-lifecycle PR #77-83 的 7 个）；唯一未合并分支 `feature/frontend-tier1-batch3`（PR #38 已关闭，5 个独有 commit）先归档为 tag `archive/feature-frontend-tier1-batch3` 再删除，工作可恢复；本地 9 个分支删除；远程仅剩 main。与 ROADMAP v1.18 既有分支治理先例（archive tag + delete）一致。
2. ✅ **v0.8.0-alpha 发布文档补全**：新增 `docs/releases/v0.8.0-alpha.md`（内容取自 RELEASE_NOTES v0.8.0 段）+ 更新 GitHub Release 正文。
3. ✅ **.env.example 版本收敛**：NEXT_PUBLIC_RELEASE_VERSION v0.6.0-alpha → v0.8.0-alpha。

## 6. 优化建议清单（按收益/成本排序，供下一阶段选型）

| # | 建议 | 收益 | 成本 | 对应审计项 |
| --- | --- | --- | --- | --- |
| 1 | **销售侧 GL 记账闭环**（Invoice ISSUE→借1122应收/贷6001收入+销项税；收款核销→借1002银行/贷1122应收；补 seed 科目） | 高（利润表/试算平衡完整，Sprint 7 续） | 中 | 中国审计 P0 |
| 2 | **v0.9.0-alpha Release Gate**（GL+成本+UI 批次基线，含 RELEASE_NOTES/QA/CHANGELOG 同步） | 高（发布治理） | 低 | 治理 P1 |
| 3 | **启用 main 分支保护**（PR + CI checks） | 高（强制 CI-First） | 低 | 治理 P0 |
| 4 | 错误码注册表自动化 + CI gate | 高 | 低 | 代码 P1 |
| 5 | CRUD 乐观锁原子化（updateMany CAS） | 高 | 中 | 代码 P1 |
| 6 | 时区策略落地（TZ=Asia/Shanghai + 业务日工具，修 GL dateTo） | 中高 | 低 | 代码 P1 / 中国部署 |
| 7 | 财务链路路由级集成测试 | 高 | 中高 | 代码 P1 |
| 8 | .npmrc 配 npmmirror registry + Docker 国内镜像说明 | 中 | 极低 | 中国部署 |
| 9 | 增值税发票管理字段（发票类型/代码/号码/红字，P1 中国缺口） | 高 | 高 | 中国审计 P1 |
| 10 | 会计期间体系（期间表+凭证期间校验+凭证字） | 高 | 中高 | 中国审计 P1 |
| 11 | 认证存储升级（httpOnly cookie + CSRF/CSP） | 中 | 中高 | 代码 P1 |
| 12 | AGENTS.md §3 / ROADMAP v1.26 治理同步 | 中 | 低 | 治理 P1 |

## 7. 下一开发项提案（Design/Scope Gate 待 CTO 拍板）

按"中国 ERP 上线优先级 + Sprint 7 Finance 延续 + 现有事件/科目基础设施复用"综合评估，推荐顺序：

1. **A（推荐）：销售侧 GL 记账闭环**——复用已有 InvoiceIssued/ReceiptAllocated 事件与 GL consumer 框架，补齐 1122/6001/销项税科目与映射，2-3 个 PR 即可让利润表/试算平衡完整；直接命中中国审计 P0 与 ROADMAP"GL 过账其余子项仍后续"。
2. **B：v0.9.0-alpha Release Gate**——先于 A 或与 A 并行（文档治理，不含代码范围）。
3. **C：增值税发票管理**（大范围，建议单独 Design Gate）。
4. **D：会计期间体系**（与 A 联动：凭证期间校验依赖期间表）。

---

*审计完成：分支整理已执行；发布文档/环境示例已修复；代码与 schema 未改动（仅文档）。CI 验证：本次修改为纯文档/示例，push 后以 GitHub CI 为准。*
