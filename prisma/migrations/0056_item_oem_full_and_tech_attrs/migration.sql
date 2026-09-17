-- Migration 0056 — 商品来源追加「OEM 外协（含工含料）」+ Item 技术属性（产品精度等级 / 预压值）（用户指令 2026-09-17 修改一）
-- 业务：①物料管理「商品来源」新增 OEM 外协（含工含料）= 外协厂包工包料，与既有 OEM 外协（含工不含料：我方供料 + 加工费）并存；
--       ②物料管理「技术属性」新增 产品精度等级 / 预压值（既有 LinearGuideSpecification.precisionGrade/preload 为导轨专用扩展列，不在本迁移变更范围）。
-- 红线：仅 ALTER TYPE ... ADD VALUE / ALTER TABLE ... ADD COLUMN（不重建表、不改既有列、不做数据回填、不删除任何列）。
-- 说明：PG16 事务内 ADD VALUE 允许——本迁移仅追加枚举定义，不使用新值。

-- 1) 商品来源：追加「OEM 外协（含工含料）」（保留既有 BOUGHT / SELF_MANUFACTURED / OEM_OUTSOURCED）
ALTER TYPE "ItemSourcingType" ADD VALUE IF NOT EXISTS 'OEM_OUTSOURCED_FULL';

-- 2) Item 技术属性：产品精度等级 / 预压值（通用物料技术属性；可空，无默认值，无回填）
ALTER TABLE "Item" ADD COLUMN "precisionGrade" TEXT;
ALTER TABLE "Item" ADD COLUMN "preload" TEXT;
