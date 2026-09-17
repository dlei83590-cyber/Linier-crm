# 物料管理「修改一」QA（商品来源 OEM 含工含料 + 技术属性调整）

> 日期：2026-09-17 ｜ 指令：用户「物料管理：①商品来源新增 OEM 外协（含工含料）②技术属性添加（产品精度等级、预压值）、删除（变型/条码/图号/图版/版本）」｜ 范围：Schema（Migration 0056）+ API 字段 + items 前端页面
> 验证事实源：GitHub CI（Quality Gates / Build / Secret Scanning）——本地未运行 build/test/type-check/lint

## 范围

- **Schema（Migration 0056）**：`ItemSourcingType` 追加 `OEM_OUTSOURCED_FULL`；`Item` 追加 `precisionGrade` / `preload`
- **API**：`POST /api/items`、`PATCH /api/items/:id` zod schema 接受 `sourcingType=OEM_OUTSOURCED_FULL` 与 `precisionGrade`/`preload`
- **前端**：物料新建/编辑「商品来源」下拉 + 「技术属性」分区；物料详情「技术属性」；BOM 详情成品来源标签
- **不在范围**：OEM 生产/外协工单流程（`ProductionOrderType.OEM_OUTSOURCING` 语义不变）、BOM 需求量、移动加权成本、库存 Ledger、GL、`LinearGuideSpecification`（导轨专用列不变更）

## 变更清单

| 类别 | 文件 |
|---|---|
| Schema | `prisma/schema.prisma`（ItemSourcingType + 2 列）；`prisma/migrations/0056_item_oem_full_and_tech_attrs/migration.sql`（仅 ADD VALUE + ADD COLUMN） |
| API | `apps/web/src/app/api/items/route.ts`；`apps/web/src/app/api/items/[id]/route.ts` |
| 前端 | `apps/web/src/app/(dashboard)/items/new/page.tsx`；`items/[id]/edit/page.tsx`；`items/[id]/page.tsx`；`inventory/boms/[id]/page.tsx`（来源标签） |
| 文档 | `docs/ADR/ADR-0049-item-sourcing-bom-production.md`（追加节）；`docs/CHANGELOG.md`；`docs/ROADMAP.md`；`docs/openapi.yaml`（Item/ItemCreate/ItemUpdate + ItemSourcingType）；`docs/DOMAIN_MODEL.md`；`docs/architecture/domain-model.md`；`docs/frontend/contract-cards/items.md` |

## 静态复核（本地允许项）

- [x] diff 仅含本指令范围（Schema / items API / items 页面 / BOM 详情标签 / 文档）
- [x] Migration 0056 仅 `ALTER TYPE ... ADD VALUE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN`——不重建表、不改既有列、不删列、不迁移/回填数据；PG16 事务内 ADD VALUE 允许且本迁移不使用新值
- [x] Schema ↔ Migration 一致：枚举值 `OEM_OUTSOURCED_FULL`（schema 末尾追加，与 ADD VALUE 顺序一致）；列 `precisionGrade`/`preload` = `TEXT` ↔ `String?`（可空、无默认）
- [x] 删除项为**页面呈现收敛**：`Item.variant/barcode/drawingNo/drawingVersion/revision` 列与 API 字段保留（`/api/items/:id/revisions` 仍写 `Item.revision`），零数据删除；全仓 grep 确认 items 新建/编辑/详情无残留引用
- [x] 新增字段贯通三段：表单 state → PATCH/POST payload（`|| null` / `|| undefined`）→ zod schema（nullable/optional）→ 详情回显（GET 返回整行 Item，无需 include 改动）
- [x] 零新权限、零新错误码、零新事件、零新 API、零新依赖
- [x] 无平行真相：不写 `LinearGuideSpecification`（导轨专用规格仍为权威），不做双写/同步；`sourcingType` 仍为来源标注事实，不参与 BOM/工单/成本判定分支
- [x] OpenAPI 同步（Item/ItemCreate/ItemUpdate 字段 + `ItemSourcingType` 枚举组件；顺带补齐 0047 起未同步的 `sourcingType` 漂移）

## 运行时验收（需人工登录，本仓库无本地服务器）

- [ ] 物料新建：商品来源可选「OEM 外协（含工含料：外协厂包工包料）」→ 保存 → 详情页商品来源显示一致
- [ ] 物料编辑：商品来源由 OEM（含工不含料）切到 OEM（含工含料）→ CAS 保存成功 → 详情一致
- [ ] 技术属性：产品精度等级 / 预压值 填写 → 保存 → 详情「技术属性」回显；清空 → 保存 → 详情显示「—」
- [ ] 技术属性：确认页面不再出现 变型 / 条码 / 图号 / 图版 / 版本（新建、编辑、详情三页）
- [ ] 既有数据回归：老物料（含 `Item.variant/barcode/drawingNo/drawingVersion/revision` 存量值）编辑保存不报错、存量列值不被前端清空

## Known Risk

- 存量物料的历史 `variant/barcode/drawingNo/drawingVersion/revision` 值不再有页面入口（DB/API 保留），如需维护须走 API 或后续 Gate 决定是否加回/迁移
- 含工含料的 OEM **暂不进入生产/外协工单**（无领料 OUT，成本口径仍为既有 OEM 工单模型）；是否工单化留待后续 Design Gate
- `Item.precisionGrade/preload` 与 `LinearGuideSpecification.precisionGrade/preload` 同名并存，当前无双向同步（导轨类物料两处可填，语义分工见 ADR-0049 追加节）
