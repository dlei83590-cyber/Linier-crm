# 产品路线图（ROADMAP）

- 版本：v1.0
- 日期：2026-08-05
- 维护者：CIO（JINZA）｜审核：CTO
- 状态说明：✅ 已完成 ｜ 🔄 进行中 ｜ ⬜ 未开始
- **本文件是项目唯一开发路线依据，CTO / CIO / 开发人员一律以此为准，不再依赖聊天记录推进项目。**

---

## 1. 总览（Sprint 1-10）

| Sprint | 主题 | 状态 | 备注 |
| --- | --- | --- | --- |
| Sprint 1 | Infrastructure（基础设施） | ✅ | 认证 / RBAC / Railway / CI |
| Sprint 2 | Master Data（主数据） | ✅ | 中国版主数据 + 项目领域 + 企业字段补强 |
| Sprint 3 | System Foundation（系统底座） | ⬜ | Phase A 系统底座 + Phase B 业务底座 |
| Sprint 4 | Sales（销售） | ⬜ | Phase C |
| Sprint 5 | Purchase（采购） | ⬜ | Phase D |
| Sprint 6 | Inventory（库存） | ⬜ | Phase E |
| Sprint 7 | Finance（财务） | ⬜ | Phase F |
| Sprint 8 | BI（商业智能） | ⬜ | 报表 / Dashboard / 数据分析 |
| Sprint 9 | OA（办公协同） | ⬜ | 审批 / 消息 / 日程 / 知识库 |
| Sprint 10 | Mobile（移动端） | ⬜ | 移动应用 / 小程序 |

> 依赖顺序：1 → 2 → 3 → 4/5/6 → 7 → 8 → 9 → 10
> （Sprint 4-6 可部分并行，但都依赖 Sprint 3 Phase B 业务底座；Sprint 7 依赖 4-6 的单据）

---

## 2. Sprint 1：Infrastructure ✅

**目标：可部署骨架 + 安全边界。**

- ✅ 项目脚手架（web / API / 数据库 / shared 契约）
- ✅ 格式化 / lint / 类型检查 / 单测 / 构建命令
- ✅ CI：Quality Gates + Secret Scanning + Build + Generate Lockfile
- ✅ 认证与会话（JWT via jose、bcrypt）
- ✅ 用户 / 部门 / 角色 / 权限 / 用户角色 / 审计日志
- ✅ RBAC 在可健康检查的 API 切片上生效
- ✅ Railway 部署 + 测试账户 + 本地环境 runbook
- ✅ Release v0.1.0-alpha（PR #3 合并、tag、Release）

---

## 3. Sprint 2：Master Data ✅

**目标：中国工业企业（直线导轨制造与贸易）数据架构与字段标准。**

### Sprint 2A：中国版主数据（PR #4 内容）

- ✅ Item 统一物料（6 类：成品/原材料/配件/外购件/服务/包装物）
- ✅ LinearGuideSpecification（直线导轨专用规格，1:1 扩展）
- ✅ BusinessPartner 统一往来单位（客户/供应商/两者），含统一社会信用代码 / 纳税人类型 / 开票 / 银行 / 结算
- ✅ PriceList + PriceListItem 含税价格体系（未税/税率/税额/含税）
- ✅ TechnicalStandard + ItemStandard、UnitOfMeasure、CommercialTerm、DocumentSequence
- ✅ 默认币种 CNY；默认税率可配置（DEFAULT_TAX_RATE，默认 13，不写死）
- ✅ 全表审计字段（创建人/修改人/审核人/审批状态/版本/软删除）

### Sprint 2B：项目领域模型（PR #4 内容）

- ✅ 14 模型 + 8 枚举：ProjectOpportunity → Project 双段模型（1:1 可断开）
- ✅ 项目阶段 11 态：线索/准入/方案/报价/试样/测试/小批量/批量供货/暂停/失败/结项
- ✅ 关系人 5 角色：需求人/技术人/采购人/决策人/使用人
- ✅ 12 子模型：关系人/成员/里程碑/任务/预算/费用/项目物料/风险/走访/进展/验收/结项
- ✅ 财务字段：客户投入/预计营收/成本/毛利/费用预算/销售目标/回款状态/竞争对手/成功概率

### Sprint 2C：企业字段补强（CTO 评审建议，PR #4 内容）

- ✅ BusinessPartner +14 企业字段（简称/全称/集团/区域/行业/规模/信用/来源/成立日期/注册资本/员工数/官网/公众号/标签）
- ✅ Item +14 工业字段（品牌/制造商/OEM/客户料号/供应商料号/图号/图纸版本/生命周期/停产/替代料/最小包装/采购周期/MOQ/安全库存）
- ✅ PriceList +priceType（采购/销售/VIP/代理/工程/战略/区域/客户专属/历史 9 类价格）
- ✅ Project +9 财务字段（合同金额/利润/毛利率/回款/开票/应收/评级/失败原因）
- ✅ DocumentSequence +docType（DocumentType 17 种单据：SO/PO/PI/CI/DO/GRN/GI/Invoice/CN/DN/PV/Receipt/Expense/Journal/Quotation/Contract/Project）
- ✅ 权限动作级设计：view/create/edit/delete/approve/audit/export/import/assign/close
- ✅ 迁移 0002_master_data_cn + 0003_project_domain（旧 0002_master_data 未上线已重建）

---

## 4. Sprint 3：System Foundation（系统底座）⬜

**原则：不开发业务页面，优先 ERP 底座能力；完成后再开发业务模块效率更高。**

### Phase A：系统底座

| 模块 | 内容 | 依赖 |
| --- | --- | --- |
| Workflow Engine | 流程定义 / 流程实例 / 节点 / 流转 / 条件分支 | RBAC |
| Approval Engine | 审批单 / 审批人 / 会签 / 或签 / 委托 / 加签 / 驳回 | Workflow + RBAC |
| Notification | 站内信 / 邮件 / 消息模板 / 已读未读 | — |
| Dictionary | 字典类型 / 字典项（通用下拉数据源） | — |
| System Settings | 参数配置（税率/币种/单据规则等，环境变量+库内配置） | — |
| File Center | 文件上传 / 附件关联任意业务 / 下载 / 权限 | Notification |
| Dashboard API | 统计接口（销售漏斗/项目看板/应收/库存/利润） | 业务数据 |
| Menu Management | 菜单树 / 菜单权限绑定（数据驱动导航） | RBAC |

### Phase B：业务底座（主数据 CRUD 完整化）

| 模块 | 内容 | 依赖 |
| --- | --- | --- |
| Customer CRUD | 客户完整增删改查（含 2C 企业字段） | 2A/2B 模型 |
| Supplier CRUD | 供应商完整增删改查 | 2A/2B 模型 |
| Item CRUD | 物料完整增删改查（含工业字段/规格扩展） | 2A/2B 模型 |
| Price List CRUD | 价格表完整增删改查（9 类价格/阶梯/审批） | 2A/2B 模型 |
| Project CRUD | 项目完整增删改查（机会→项目全生命周期） | 2B 模型 |

> 说明：CRUD 复用 api-helpers（鉴权/权限/审计）+ 动作级权限 + 审计日志。

---

## 5. Sprint 4：Sales（销售）⬜ — Phase C

| 模块 | 说明 |
| --- | --- |
| Quotation | 报价单（引用价格表，含税/未税，审批流） |
| Sales Order | 销售订单（引用报价/项目/物料，单据编号走 DocumentSequence） |
| Contract | 合同（关联订单/项目，金额/条款/附件） |
| Delivery | 发货单（DO，关联订单，触发库存出库） |
| Invoice | 销售发票（CI，关联发货/订单，应收挂账） |
| Payment | 收款（回款核销，更新应收余额） |

---

## 6. Sprint 5：Purchase（采购）⬜ — Phase D

| 模块 | 说明 |
| --- | --- |
| Purchase Request | 请购单（需求来源：库存预警/项目/手工） |
| Purchase Order | 采购订单（PO，引用供应商/物料/价格） |
| GRN | 收货单（GRN，入库触发库存） |
| Supplier Invoice | 供应商发票（应付挂账） |
| Payment | 付款（核销应付） |

---

## 7. Sprint 6：Inventory（库存）⬜ — Phase E

| 模块 | 说明 |
| --- | --- |
| Warehouse | 仓库 / 库位 |
| Stock | 库存余额（物料×仓库，实时） |
| Batch | 批次管理（批号/效期/追溯） |
| Inventory Movement | 库存流水（出入库/调拨/调整，全追溯） |
| Stock Count | 盘点（盘点单/差异/调整） |
| Transfer | 调拨（仓库间转移） |

> Item 的 2C 字段（安全库存/MOQ/最小包装/采购周期）在此直接复用。

---

## 8. Sprint 7：Finance（财务）⬜ — Phase F

| 模块 | 说明 |
| --- | --- |
| AR | 应收（销售发票/收款核销/账龄） |
| AP | 应付（采购发票/付款核销） |
| Expense | 费用报销（项目费用/日常费用，走审批流） |
| Voucher | 凭证（记账凭证，来源单据自动生成/手工） |
| Journal | 日记账 |
| General Ledger | 总账（科目余额/试算平衡） |
| Profit | 利润（收入-成本-费用，按期间/项目/客户） |
| Cash Flow | 现金流量（收/支/结余） |

---

## 9. Sprint 8：BI（商业智能）⬜

- 报表中心：销售漏斗 / 项目漏斗 / 订单 / 采购 / 库存 / 应收应付 / 利润
- Dashboard（复用 Sprint 3 Dashboard API）
- 导出（Excel/CSV，权限动作 export）
- 数据口径与权限（按角色/部门/区域）

---

## 10. Sprint 9：OA（办公协同）⬜

- 审批中心（统一待办，复用 Approval Engine）
- 消息中心（复用 Notification）
- 日程 / 任务 / 纪要
- 知识库 / 文档（复用 File Center）
- 企业微信 / 钉钉 / 邮件对接（可选）

---

## 11. Sprint 10：Mobile（移动端）⬜

- 移动端应用 / 小程序
- 移动审批 / 单据录入 / 库存查询 / 消息提醒
- 离线能力（可选）

---

## 12. 里程碑与验收

| 里程碑 | 内容 | 判定 |
| --- | --- | --- |
| M1 | Sprint 1 完成 | Release v0.1.0-alpha ✅ |
| M2 | Sprint 2 完成 | PR #4 合并（等 CTO 最终审核） |
| M3 | Sprint 3 完成 | 系统底座可支撑业务模块开发 |
| M4 | Sprint 4-6 完成 | 进销存闭环可用 |
| M5 | Sprint 7 完成 | 财务闭环可用 |
| M6 | Sprint 8-10 完成 | 数据驱动 + 移动化 |

## 13. 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-08-05 | 创建 v1.0 | 按 CTO 意见：Sprint 3 拆 Phase A（系统底座）+ Phase B（业务底座），Sprint 4-7 按销售/采购/库存/财务排序；新增 BI/OA/Mobile 远期规划；确立本文件为唯一路线依据 |
