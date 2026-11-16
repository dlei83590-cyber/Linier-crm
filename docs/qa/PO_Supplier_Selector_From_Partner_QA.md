# QA — 采购单供应商为空修复（往来单位 ⇒ 供应商档案）

- 用户报告：**「采购管理完善，在新增采购单给供应商为空，没有关联到来往单位」**
- 日期：2026-10-14
- 范围：采购单新建页（引用源可见性）+ 往来单位写路径（供应商档案自动建档）+ seed 存量自愈

## 1. 根因（事实，不是猜测）

| 观察 | 证据 |
| ---- | ---- |
| 采购单供应商下拉 = `GET /api/suppliers?pageSize=100` | `apps/web/src/app/(dashboard)/purchasing/orders/new/page.tsx`（修复前 line 123）|
| PO 创建要求 `supplierId` 指向 **Supplier 档案** | `apps/web/src/app/api/purchase-orders/route.ts`（`prisma.supplier.findFirst` → 无档案即 400）|
| 往来单位（BusinessPartner）保存时**不**建 Supplier 档案 | `POST /api/business-partners`（修复前无任何 Supplier 写入）|
| 供应商档案只能在「专门建档」动作产生，前端没有该入口 | `/suppliers` 页面不存在；BP 详情「供应商档案」空态文案写明「建档由供应商主数据/采购流程负责」|

结论：用户在主数据录入的往来单位（type=SUPPLIER/BOTH）**没有对应 Supplier 档案**，供应商下拉除 seed 演示数据外恒为空。

## 2. 修复（写入即建档 + 存量自愈 + 前端可见性）

- `apps/web/src/lib/supplier/provision.ts` — `ensureSupplierArchive(tx, partner, actorId)`：
  - 只对 type=SUPPLIER/BOTH 建档；客户类型完全不触碰 Supplier 表；
  - 幂等：已有档案（含软删/停用）只复活不重建（`Supplier.partnerId` @unique = 1:1 角色扩展）；
  - 编码：沿用往来单位编码 → 被其他档案占用时用确定性候选「编码-往来单位 id 尾段[-n]」→ 仍冲突则 `SUPPLIER_ARCHIVE_CODE_EXHAUSTED` fail loud；
  - 同事务 upsert `BusinessPartnerRole(roleType=SUPPLIER)`。
- `POST /api/business-partners`：BP create 与建档收敛到 **一个 `$transaction`**（档案失败 → 整体回滚，不留半成功事实）。
- `PATCH /api/business-partners/:id`：CAS 更新成功后在同一事务内 ensure（往来单位改为「供应商/客户兼供应商」后立即补档）。
- `prisma/seed.ts`：幂等 backfill —— 所有 type=SUPPLIER/BOTH 往来单位补齐档案与角色行（部署 update 脚本含 seed 即生效；编码耗尽时 `console.warn` 留痕人工处理）。
- `purchasing/orders/new/page.tsx`：引用源改为每源独立取数（`useReferenceOptions`），字段级失败可见 + 重试；供应商为空（成功 0 条）时提示「档案来自往来单位」+ `/business-partners/new` 入口。

## 3. 验收清单（Runtime，部署后人工 Smoke）

| # | 步骤 | 期望 |
| - | ---- | ---- |
| 1 | 主数据 → 新建往来单位，类型=供应商 → 保存 | 201；`GET /api/suppliers` 含该往来单位（编码/名称一致）|
| 2 | 采购管理 → 新建采购订单 → 供应商下拉 | 出现上一步的供应商（名称 + 编码），选中后币种自动带出 |
| 3 | 选供应商 + 物料行 + 数量 → 保存 | 201 并跳转采购订单详情（DRAFT）|
| 4 | 存量往来单位（type=供应商）→ 编辑页保存一次 | 供应商下拉立即出现该供应商（PATCH 补档）|
| 5 | 部署 update（含 seed）后打开采购单新建页 | 历史供应商型往来单位全部出现在下拉（backfill 生效）|
| 6 | 无 `supplier:view` 权限账号打开新建页 | 供应商字段显示「无权限访问（403）：缺少『supplier:view』…」+ 重试，物料等其他字段不受影响 |
| 7 | 客户类型往来单位 | **不产生**供应商档案（`GET /api/suppliers` 不含） |

## 4. 单元测试（GitHub CI 为验证事实源）

- `apps/web/src/lib/supplier/provision.test.ts`：SUPPLIER/BOTH 建档、客户不建档、幂等复用、软删复活、编码候选、编码耗尽 fail loud。
- `apps/web/src/app/api/business-partners/route.test.ts`：create type=SUPPLIER 同事务建档 + 角色行；type=CUSTOMER 不建档。
- `apps/web/src/app/api/business-partners/[id]/route.test.ts`：PATCH type→SUPPLIER 补档；保持 CUSTOMER 不补档。
- `apps/web/src/app/(dashboard)/purchasing/orders/new/page.test.tsx`：供应商源成功/为空/失败三态 + 失败不级联 + POST 契约。

## 5. 边界（明确未做）

- 零 Schema / Migration / 错误码 / Event / RBAC 变更。
- 未改 `PurchaseOrder.supplierId → Supplier` 语义（不改用 BusinessPartner.id，避免平行业务真相）。
- 未删除/重建任何既有供应商档案；未改动档案业务字段（status/rating/账期/资质）。
- 未新增「供应商档案」独立页面（档案仍由往来单位角色扩展 + 供应商档案 Tab 维护）。