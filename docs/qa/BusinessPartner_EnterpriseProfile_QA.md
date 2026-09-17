# 往来单位「修改二」QA（企业资质 + 企业类型勾选）

> 日期：2026-09-17 ｜ 指令：用户「往来单位：增加企业资质（科技型中小企业、创新型中小企业、高新企业、专精特新企业等）、企业类型（国有、私企、上市、非上市），勾选」｜ 范围：Schema（Migration 0057）+ API 字段 + 往来单位前端页面
> 验证事实源：GitHub CI（Quality Gates / Build / Secret Scanning）——本地未运行 build/test/type-check/lint

## 范围

- **Schema（Migration 0057）**：新枚举 `EnterpriseQualification` / `EnterpriseOwnershipType` / `EnterpriseListingStatus`；`BusinessPartner` 追加 `qualifications` / `ownershipType` / `listingStatus`
- **API**：`POST /api/business-partners`、`PATCH /api/business-partners/:id` z.enum fail closed；`qualifications` 落库前去重
- **前端**：往来单位新建/编辑「企业资质与类型」分区（勾选）；详情「工商资料」展示
- **不在范围**：资质证书号/有效期/附件（属 `SupplierQualification` 语义）、列表筛选器、资质字典表（运维自助维护，HOLD）

## 决策依据（用户确认）

1. 企业类型**拆两个独立维度**：所有制性质（国有/私企/外资/合资）+ 上市状态（上市/非上市），避免「国有 vs 上市」正交语义在四选一中丢失
2. 企业资质用**固定枚举数组列**（可筛选/可统计），扩展走「追加枚举值 + Migration」
3. 资质清单本次固定 5 项（含专精特新中小企业与专精特新「小巨人」）

## 变更清单

| 类别 | 文件 |
|---|---|
| Schema | `prisma/schema.prisma`（3 枚举 + BusinessPartner 3 列）；`prisma/migrations/0057_enterprise_qualification_profile/migration.sql` |
| SSOT 常量 | `apps/web/src/lib/business-partner/enterprise-profile.ts`（枚举 + 中文标签 + 勾选选项 + 展示映射函数） |
| 共用组件 | `apps/web/src/components/ui/checkbox-group.tsx`（多选 / 单选可反选） |
| API | `apps/web/src/app/api/business-partners/route.ts`；`apps/web/src/app/api/business-partners/[id]/route.ts` |
| 前端 | `business-partners/new/page.tsx`；`business-partners/[id]/edit/page.tsx`；`business-partners/[id]/page.tsx` |
| 文档 | `docs/ADR/ADR-0056-business-partner-enterprise-profile.md`；CHANGELOG；ROADMAP v1.47；`docs/openapi.yaml`（BusinessPartner·CreateRequest·UpdateRequest + 3 枚举组件）；DOMAIN_MODEL；architecture/domain-model |

## 静态复核（本地允许项）

- [x] diff 仅含本指令范围（Schema / 往来单位 API / 往来单位页面 / 文档）
- [x] Migration 0057 仅 `CREATE TYPE` + `ALTER TABLE ... ADD COLUMN`——不重建表、不改既有列、不删列；`qualifications` `NOT NULL DEFAULT ARRAY[]::...` → 存量行零回填即「未认定」
- [x] Schema ↔ Migration 一致（3 枚举名/取值一致；3 列类型 = 枚举数组 / 枚举 / 枚举）
- [x] SSOT 单点：枚举与中文标签仅 `enterprise-profile.ts` 一处定义，API zod、新建/编辑勾选、详情展示全部引用（禁止两处漂移，同 ADR-0054 channel 模式）
- [x] 服务端 fail closed：未知 code → 400；`qualifications` 落库前去重（禁重复 code canonical）；PATCH 走既有 CAS（version）路径，未绕过乐观锁
- [x] 三字段贯通三段：表单 state → payload（POST `|| undefined` / PATCH `|| null`）→ zod → 详情回显（GET 返回整行，无 select 裁剪）
- [x] 不复用/不合并 `SupplierQualification`（证书号/有效期/附件 = 合规档案维度）；不改 `tags`/`creditRating`/`customerLevel`/`channel` 语义
- [x] 零自动判定耦合：企业资质/所有制/上市状态不参与价格、信用、审批、供应商推荐任何分支
- [x] 零新权限、零新错误码、零新事件、零新 API、零新依赖
- [x] 无障碍/HTML 合法性：字段标签为 `span`（不嵌套 label），勾选项为原生 `label + checkbox`

## 运行时验收（需人工登录，本仓库无本地服务器）

- [ ] 新建往来单位：勾选「高新技术企业 + 专精特新中小企业」→ 选「私企」+「非上市」→ 保存 → 详情「工商资料」显示两枚资质徽章 + 私企 + 非上市
- [ ] 编辑：取消勾选一项资质 / 切换所有制 → 保存 → 详情一致（CAS version 正常 +1）
- [ ] 单选可反选：再次点击已选「国有」→ 取消 → 保存 → 详情显示「—」（未设置语义保留）
- [ ] 非法值拒绝：直接调 API 传 `qualifications: ["NOT_A_CODE"]` → 400（fail closed）
- [ ] 存量回归：老往来单位（Migration 前创建）打开编辑 → 资质区未勾选、所有制/上市为空，保存其它字段不报错且不误写三字段
- [ ] 供应商档案页「资质证书」（SupplierQualification）不受影响，两处互不干扰

## Known Risk

- 企业资质本次为**标注事实**，不校验真实性（无证书号/有效期/复审提醒）；若后续需要年审失效管理，须另开 Design Gate
- 列表页暂未提供「按企业资质筛选」入口（数据可筛选，仅 UI 未接入）；如需按资质筛选/统计再追加
- 资质项扩展需发版（枚举 + Migration），非运维自助
