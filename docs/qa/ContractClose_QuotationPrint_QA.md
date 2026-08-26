# CC-05 QA — 报价固定个性化打印模板（Quotation Print View）

> 线：Contract Close（合同功能最终收口）→ CC-05 报价固定个性化打印模板 | 分支：feature/contract-close-quotation-print
> 日期：2026-08-25 | 验证方式：GitHub CI（Quality Gates → Build → Secret Scanning）+ 生产 Smoke（人工）
> 关联：docs/frontend/contract-cards/quotations.md、docs/test-cases/Quotation_API.md（§J）、docs/openapi.yaml（QuotationResponse/QuotationLine）
> 决策：不开发 Template Designer；交付一个正式可生产的 Linier 标准报价单 Print Layout，继续浏览器打印（window.print）。
> 红线：禁止 PDF/Word 引擎、模板拖拽器、富文本模板平台；零 Schema（本线仅 additive 只读投影）。

## 1. 交付范围

### 1.1 页面
| 页面 | 路由 | 说明 |
| --- | --- | --- |
| 报价打印视图 | `/sales/quotations/[id]/print` | 独立 Print View：A4 标准报价单，复用 GET /api/quotations/:id 真实数据；工具栏（返回/打印）print 时隐藏 |
| 报价详情入口 | `/sales/quotations/[id]` | 「打印」按钮由 window.print 详情页升级为跳转打印视图 |

### 1.2 API（无新端点，仅 GET /api/quotations/:id additive 只读投影）
| 投影 | 字段 | 事实来源 |
| --- | --- | --- |
| 客户联系/地址 | customer.fullName/contactPerson/phone/email/address | BusinessPartner（SSOT） |
| 销售负责人 | customer.ownerships[0].owner（releasedAt=null） | CustomerOwnership 客户归属 SSOT |
| 行单位 | lines[].uom {id,code,name,symbol} | QuotationLine.uom → UnitOfMeasure |
| 行规格 | item.spec（+ 既有 model） | Item（SSOT） |

### 1.3 打印布局（A4）
公司 Logo/名称 → 报价单号/日期/有效期 → 客户（名称/联系人/地址）→ 报价行（序号/产品编码/产品名称/规格/数量/单位/单价/金额）→ 汇总（小计/税额/总金额）→ 商务条款/备注 → 底部（销售负责人/客户确认/公司签章位置）。

## 2. 测试要点

| # | 场景 | 验证方式 | 实现位置 |
| --- | --- | --- | --- |
| T1 | 打印视图渲染报价行/汇总金额/条款/客户/销售负责人 | 单元测试（vitest，page.test.tsx） | print/page.test.tsx |
| T2 | 无明细空态 + 汇总按 0.00 展示 | 单元测试 | print/page.test.tsx |
| T3 | 金额千分位 + 2 位小数格式化 | 单元测试（formatMoneyValue） | print/page.test.tsx |
| T4 | 打印按钮调用 window.print | 单元测试（spy window.print） | print/page.test.tsx |
| T5 | 接口失败 → 真实错误面板（不伪装空态） | 单元测试 | print/page.test.tsx |
| T6 | 详情接口携带打印投影（客户联系/地址/owner + 行 uom/spec） | API 单元测试（route.test.ts 防回归） | api/quotations/[id]/route.test.ts |
| T7 | 权限门禁 quotation:view | PermissionGuard + API requirePermission | print/page.tsx |
| T8 | A4 打印：thead 跨页重复 / 金额右对齐 / 中文字体 / 导航隐藏 | 生产 Smoke（浏览器打印预览） | print-view.module.css + globals.css @media print |

## 3. 生产 Smoke（人工，合并后执行）

- [ ] step 1：登录 → 销售管理 → 报价单 → 打开一张真实报价详情
- [ ] step 2：点击「打印」→ 进入 /sales/quotations/[id]/print 打印视图（白纸预览 + 工具栏）
- [ ] step 3：Ctrl+P / 打印按钮 → 浏览器打印预览（A4）→ 确认系统导航（顶栏/侧栏/工具栏）未进入纸张
- [ ] step 4：打开 2 页以上（明细多行）的报价 → 第二页表头（序号/编码/名称/规格/数量/单位/单价/金额）完整重复
- [ ] step 5：核对金额右对齐、千分位格式化、客户名称/联系人/地址、条款/备注、销售负责人完整
- [ ] step 6：报价详情「打印」按钮未破坏原有动作按钮（编辑/提交/接受/取消/转订单）

## 4. 已知限制（真实限制，不写规划）
- 公司 Logo/名称 = 模板常量「Linier CRM」文本标（仓库无 Company 主数据模块；禁止为打印头新建 Schema）；
  公司主体信息落地后需切换为真实主体资料（属后续独立功能，不在本线）。
- 销售负责人 = 客户当前归属（CustomerOwnership SSOT）派生，非报价单独立负责人字段（报价表无该字段，
  禁止为打印新建 Schema）。
- 打印走浏览器（window.print）与 globals.css @media print 隐藏导航；分页行为依赖浏览器 print CSS 实现。

## 5. 验收状态
- [x] CI：Quality Gates（lint→RBAC→error-codes→prisma generate→type-check→unit tests）+ Build + Secret Scanning
- [ ] 生产 Smoke（人工，见 §3）
- [ ] CTO Review
