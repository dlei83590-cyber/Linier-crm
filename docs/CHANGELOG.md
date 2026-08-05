# CHANGELOG

所有重要变更都会记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增（Sprint 2B/2C，PR #4，feature/sprint2-master-data）

- 中国版主数据：Item 统一物料（6 类）+ LinearGuideSpecification + BusinessPartner 统一往来单位（统一社会信用代码/开票/银行/结算）
- 项目领域 14 模型 + 8 枚举：ProjectOpportunity → Project 双段模型、11 阶段、5 关系人角色、里程碑/任务/预算/费用/风险/走访/进展/验收/结项
- 企业字段补强：BusinessPartner +14、Item +14（品牌/OEM/图号/替代料/MOQ/安全库存等）、PriceList +priceType（9 类价格）、Project +9 财务字段
- DocumentSequence +docType（DocumentType 17 种单据）
- 权限动作级设计：view/create/edit/delete/approve/audit/export/import/assign/close
- 迁移：`0002_master_data_cn` + `0003_project_domain`
- 文档体系：ROADMAP.md、PRODUCT_VISION.md、DOMAIN_MODEL.md、SPRINTS/、ADR/（规范目录）

### 变更

- 前端：移除 products/suppliers/materials 占位页，新增 10 个主数据/项目占位页
- 默认税率改为环境变量 `DEFAULT_TAX_RATE`（默认 13，不写死）

## [v0.1.0-alpha] - 2026-08-04

### 新增（Sprint 1，PR #3）

- Monorepo 骨架：pnpm workspace + Turborepo + Next.js 15 App Router
- 认证：JWT（jose HS256）+ bcryptjs，登录/会话接口
- RBAC：User/Department/Role/Permission/UserRole/AuditLog 6 模型
- CI：Quality Gates + Secret Scanning + Build + Generate Lockfile
- Railway 部署 + 测试账户

详见 [RELEASE_NOTES.md](./RELEASE_NOTES.md)。
