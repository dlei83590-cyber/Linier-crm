# Phase 3 — Customer 360 客户档案剩余能力 MVP QA 验收记录（多产品 / 多供应商 / 文档）

- 日期：2026-09（PR：feat/contract-customer-profile-mvp）
- 关联：ROADMAP Phase 1 合同验收范围「客户档案」；Migration 0051；ADR-0028（RBAC 防漂移，复用 business-partner/file-attachment 权限模块）
- 状态：**CI 验证通过（GitHub Actions 三闸）；Runtime Acceptance = 待生产部署后执行（CI-First，本地不跑 runtime）**

## 1. 范围

| 提交 | 内容 | CI |
|---|---|---|
| 客户档案剩余能力 MVP（Migration 0051） | CustomerProduct（客户→多产品）+ CustomerSupplier（客户→多供应商）+ Customer 360 文档 Tab（复用 File Center FileAttachment，businessType=business-partner，零新表） | ✅ success（待 CI 确认） |

## 2. 静态验收（本地已核）

- [x] Migration 0051 与 schema 一致（2 表 + 唯一约束 + 索引 + FK；仅 CREATE TABLE/INDEX/CONSTRAINT，对齐 0048-0050 手写约定）
- [x] CustomerProduct @@unique([businessPartnerId, itemId])：重复关联 409 CONFLICT，fail-closed（create 不被调用）
- [x] CustomerSupplier @@unique([customerId, supplierId])：重复关联 409；自关联 400；supplier type ∈ {SUPPLIER, BOTH} 校验（非供应商 400）
- [x] 客户文档复用 File Center：FileAttachment（businessType="business-partner"）零新表；文件元数据走既有 POST /api/files
- [x] 权限复用：products/suppliers → business-partner:view/edit；attachments → file-attachment:view/create/delete（不新增权限模块，PERMISSION_MODULES/seed 零变更）
- [x] 软删除语义：DELETE 置 deletedAt+isActive=false（产品/供应商关联、文档挂载），不物理删除；文档解除挂载不删 File 本体
- [x] 新增 API 均按现有 route 模式（authenticate + requirePermission + requestLog + ok/fail* + writeAuditLog + handleServerError）
- [x] Customer 360 新增 Tab：产品 / 供应商 / 文档（已有 Tab 保留：概览/工商/开票/联系人/地址/信用/标签/商机/项目/报价/销售订单/应收/活动/公海）
- [x] 关键测试：products route.test.ts（创建/校验/唯一冲突/删除）、suppliers route.test.ts（类型/自关联/唯一冲突/删除）、attachments route.test.ts（挂载/文件校验/重复/解除）

## 3. 需在生产 Runtime 验收（部署后执行）

- [ ] 客户详情 → 「产品」Tab → 选择产品+备注 → 关联成功；重复关联提示冲突；解除关联后列表刷新
- [ ] 客户详情 → 「供应商」Tab → 选择供应商（type=SUPPLIER/BOTH）→ 关联成功；选客户类型往来单位被拒；自关联被拒
- [ ] 客户详情 → 「文档」Tab → 填写文件名/编码 → 上传（POST /api/files + 挂载）→ 列表出现；解除挂载后消失且 File Center 文件仍在
- [ ] 权限矩阵：无 business-partner:edit 角色新增/解除产品/供应商 → 403；无 file-attachment:create/delete 角色上传/解除文档 → 403
- [ ] Customer 360 原有 Tab（商机/项目/报价/订单/应收/活动/公海）回归无回归

## 4. 已知限制 / 边界（HOLD）

- 附件系统重建 / generic relation framework / 文档管理平台：均 HOLD（本 PR 仅复用 File Center 元数据；真实二进制存储/预览下载未接入）
- 产品画像分析 / 供应商关系分析 / 客户×产品×供应商多维报表：未实现（后续 backlog）

## 5. 验收人

- CI 验证：GitHub Actions（Quality Gates / Secret Scanning / Build）
- Runtime Acceptance：待生产部署后由 CIO/CTO 执行（本 Gate 未执行，如实声明）
