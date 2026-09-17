# ADR-0056：往来单位企业资质 + 所有制性质 + 上市状态

- 状态：**Accepted（Implemented，2026-09-17）**
- 日期：2026-09-17
- 维护者：CIO（AI Agent 代理执行）｜审核：CTO
- 关联：用户指令「往来单位 修改二」；ADR-0012（供应商资质）/ ADR-0054（渠道 SSOT 同模式：固定枚举 + 服务端 fail closed）

---

## 背景

往来单位（`BusinessPartner` = 客户/供应商统一主体）已有工商字段（uscc / taxpayerType / legalRepresentative / registeredAddress）、企业字段（industry / companySize / creditRating / registeredCapital / employeeCount）、渠道（channel）与供应商认证资质（`SupplierQualification`：ISO9001 等，含证书号/有效期/附件）。**缺少企业级资格事实**：政府/主管部门认定的企业资质（科技型中小企业、创新型中小企业、高新技术企业、专精特新等）与所有制/上市状态，散落在自由文本或线下台账，无法筛选、统计与在销售/采购场景引用。

## 决策

1. **企业资质 = 固定枚举多选数组**：`BusinessPartner.qualifications EnterpriseQualification[]`，取值 `TECH_SME(科技型中小企业) / INNOVATIVE_SME(创新型中小企业) / HIGH_TECH_ENTERPRISE(高新技术企业) / SPECIALIZED_SME(专精特新中小企业) / LITTLE_GIANT(专精特新「小巨人」企业)`；默认空数组 = 未认定；扩展按「追加枚举值 + Migration」，不建自由文本（保持可筛选/可统计）。
2. **企业类型拆两个独立维度**（用户确认）：
   - `ownershipType EnterpriseOwnershipType?`：**所有制性质** `STATE_OWNED(国有) / PRIVATE(私企) / FOREIGN(外资) / JOINT(合资)`；
   - `listingStatus EnterpriseListingStatus?`：**上市状态** `LISTED(上市) / UNLISTED(非上市)`。
   两者语义正交（国有可上市，私企可非上市），单字段四选一会丢失维度，故拆分；均可空 = 未设置。
3. **SSOT = `apps/web/src/lib/business-partner/enterprise-profile.ts`**（同 ADR-0054 渠道模式）：枚举、中文标签、勾选组选项、标签映射函数集中一处，API zod 校验与前端 Create/Edit/详情共用，禁止两处漂移。
4. **服务端 fail closed**：`POST/PATCH /api/business-partners` 以 `z.enum` 校验写入值；`qualifications` 落库前去重（canonical，禁重复 code）；未知值 400。
5. **交互 = 勾选**：新增共用组件 `components/ui/checkbox-group.tsx`——多选（资质）原生 checkbox；单选（所有制/上市）同为 checkbox，再次点击取消（保留「未设置」语义，避免 radio 无法反选）。
6. **与 `SupplierQualification` 不复用、不合并**：后者是供应商**认证证书**（含证书号/有效期/附件/状态），属合规档案维度；本次企业资质是**主体资格标注**。二者并存、语义互不覆盖。

## 影响

- Migration 0057：3 个新枚举（CREATE TYPE）+ `BusinessPartner` 3 列（ADD COLUMN；`qualifications` NOT NULL DEFAULT 空数组，存量行零回填即「未认定」）
- API：`POST /api/business-partners`、`PATCH /api/business-partners/:id` schema 接受三字段；GET 列表/详情自动返回（无 select 裁剪）
- 前端：往来单位新建/编辑新增「企业资质与类型」分区；详情「工商资料」展示所有制/上市状态与企业资质徽章
- 零新权限、零新错误码、零新事件、零新 API、零新依赖；不触碰财务/库存/审批事实

## 兼容性

- 零破坏：新增列全部可空或带默认（`qualifications` 默认空数组），存量行语义 = 未设置；既有 `SupplierQualification`、`tags`、`creditRating` 语义不变
- 不参与任何自动判定（不驱动价格/信用/审批/推荐）；仅供人工标注与查询/统计使用

## 边界与后续

- 本次**不做**：资质有效期/证书号/附件（属 SupplierQualification 语义，若需要另开 Gate）、列表筛选器与统计看板（后续按需）、资质字典表（运维自助维护，HOLD）
- 若将来资质项需要年度复评/失效管理，走独立 Design Gate（不在此 ADR 内隐含）
