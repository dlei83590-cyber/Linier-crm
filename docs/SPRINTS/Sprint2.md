# Sprint 2：Master Data（主数据）✅

**目标：中国工业企业（直线导轨制造与贸易）数据架构与字段标准。**

| 字段 | 值 |
| --- | --- |
| 状态 | ✅ 已完成（PR #4 open，待 CTO 最终审核） |
| 分支 | feature/sprint2-master-data |

## Sprint 2A：中国版主数据

- [x] Item 统一物料（6 类）+ LinearGuideSpecification（直线导轨规格扩展）
- [x] BusinessPartner 统一往来单位（客户/供应商/两者），含统一社会信用代码/开票/银行/结算
- [x] PriceList + PriceListItem 含税价格体系（未税/税率/税额/含税）
- [x] TechnicalStandard + ItemStandard、UnitOfMeasure、CommercialTerm、DocumentSequence
- [x] 默认币种 CNY；默认税率可配置（DEFAULT_TAX_RATE=13，不写死）
- [x] 全表审计字段（创建人/修改人/审核人/审批状态/版本/软删除）

## Sprint 2B：项目领域模型

- [x] 14 模型 + 8 枚举：ProjectOpportunity → Project 双段模型（1:1 可断开）
- [x] 项目阶段 11 态 / 关系人 5 角色 / 12 子模型（里程碑/任务/预算/费用/风险/走访/进展/验收/结项等）
- [x] 财务字段：客户投入/预计营收/成本/毛利/费用预算/销售目标/回款状态/竞争对手/成功概率

## Sprint 2C：企业字段补强（CTO 评审建议）

- [x] BusinessPartner +14 企业字段（简称/全称/集团/区域/行业/规模/信用/来源/成立日期/注册资本/员工数/官网/公众号/标签）
- [x] Item +14 工业字段（品牌/制造商/OEM/客户料号/供应商料号/图号/图纸版本/生命周期/停产/替代料/最小包装/采购周期/MOQ/安全库存）
- [x] PriceList +priceType（9 类价格：采购/销售/VIP/代理/工程/战略/区域/客户专属/历史）
- [x] Project +9 财务字段（合同金额/利润/毛利率/回款/开票/应收/评级/失败原因）
- [x] DocumentSequence +docType（DocumentType 17 种单据）
- [x] 权限动作级设计：view/create/edit/delete/approve/audit/export/import/assign/close

## 工程

- 迁移：0002_master_data_cn（主数据）+ 0003_project_domain（项目领域）
- 前端：10 个新占位页（items/business-partners/projects 等）
- 文档：ADR-0002/0003、领域文档 + ERD
- CI：3e71dae / 4a9ad95 全绿

## 验收

- PR #4：open | mergeable | clean，交 CTO 最终审核
