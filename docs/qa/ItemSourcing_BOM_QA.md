# Item Sourcing + BOM + ProductionOrder QA（商品逻辑整理）

> 日期：2026-08-24 ｜ 指令：用户「整理商品逻辑——成品三大来源 + 吨→米/件/个」｜ 范围：P-1~P-3（Schema + API）+ **P-4（前端页面）**
> 验证事实源：GitHub CI（Quality Gates / Build / Secret Scanning）——本地未运行 build/test/type-check/lint

## 范围

- **P-1 Schema**（Migration 0047）：Item.sourcingType + ItemBom/ItemBomLine + ProductionOrder/ProductionOrderLine + DocumentType.PRODUCTION_ORDER + 权限注册（bom/production-order）+ PRD 单据序列 seed
- **P-2 BOM API**：/api/boms CRUD + activate（ACTIVE 唯一 + isDefault）
- **P-3 工单 API**：/api/production-orders CRUD + submit/post/cancel（POSTED 同事务：领料 OUT → 成品 IN + 成本 + 幂等 + BOM 需求下限）
- **P-4 前端**：商品来源字段（新建/编辑/详情）+ 配方列表/新建/详情/编辑 + 工单列表/新建/详情（提交/过账/取消）——已交付
- **不在范围**：生产成本归集/工序/工时/良率/工单冲销

## 变更清单

| 类别 | 文件 |
|---|---|
| Schema | prisma/schema.prisma（5 枚举 + Item.sourcingType + 2 新模型组 + 4 处关系 + DocumentType）；prisma/migrations/0047_item_sourcing_bom_production_order/migration.sql |
| RBAC | packages/shared/src/constants/index.ts（PERMISSION_MODULES + bom/production-order）；prisma/seed.ts（SEED_ACTION_MODULES + PRD sequence） |
| 错误码 | apps/web/src/lib/api/errors.ts（BOM_* ×9 + PRODUCTION_ORDER_* ×13）；docs/ERROR_CODES.md 已由 gen-error-codes.mjs 重新生成 |
| Helpers | apps/web/src/lib/item-bom/helpers.ts；apps/web/src/lib/production-order/helpers.ts |
| API | /api/boms（route + [id] + [id]/activate）；/api/production-orders（route + [id] + submit + post + cancel） |
| 测试 | apps/web/src/app/api/production-orders/[id]/post/route.test.ts（过账成功/幂等/状态门禁/BOM 下限） |
| 文档 | docs/ADR/ADR-0049；docs/test-cases/ItemBom_API.md + ProductionOrder_API.md；docs/SPRINTS/Item_Sourcing_BOM_Design.md；CHANGELOG |

## 验证记录

### 静态复核（本地允许项）

- [x] diff 仅含本 Gate 范围（Schema/API/权限/错误码/文档）
- [x] 金额/数量一律 Decimal 字符串或 Prisma.Decimal canonical 计算（禁 toNumber）
- [x] 权限码 ∈ ALL_ACTION_PERMISSIONS（bom:*/production-order:* 已注册 PERMISSION_MODULES，RBAC Catalog CI 门）
- [x] 错误码 SSOT=errors.ts，docs/ERROR_CODES.md 已同步（gen-error-codes.mjs 298 码）
- [x] POSTED 同事务：0 直写 Movement/Projection（只经 executeLedgerAtoms）；幂等 sourceKey
- [x] 并发锁序：FOR UPDATE 锁工单 + 五维投影锁（共享 Core）
- [x] 单位红线：componentUomId/行 uomId 必须 = 物料库存单位（服务端校验）
- [x] OEM 校验：供应商类型 + 加工费 >= 0；BOM 需求下限校验

### 运行时验收（需人工登录/API 调用，无本地服务器）

- [ ] 建 BOM（成品 + 吨原料 + 系数 + 损耗率）→ activate → ACTIVE 唯一
- [ ] 开自产工单（BOM 驱动）→ 提交 → 过账：原料库存减、成品库存加、成本=Σ原料成本
- [ ] 开 OEM 工单（外协厂 + 加工费）→ 过账：成本 = 原料成本 + 加工费
- [ ] 吨→米/件/个：100 件滑块 × 0.05 吨 × 1.02 = 5.1 吨领料
- [ ] 原料库存不足 → 409 且工单保持 SUBMITTED（事务回滚）

> 运行时验收项为 Known Risk：CI-First 无本地服务器验证，交付后由人工/集成测试确认。

## 风险与边界

- **GL 边界**：原料领料 OUT 经共享 Core 自动过账 COGS（借 6401 贷库存科目）——与既有 ProductionInbound 行为一致；生产领料科目待「生产成本归集」解锁后纠正
- 前端页面（P-4）未交付；ProductionInbound（1:1）保留兼容
