-- Migration 0059 — 密码策略与首次登录强制改密（ADR-0059，用户指令 2026-09-21）
-- 业务：①新建用户初始密码固定 123456（管理员不再自定密码）；②用户首次登录必须改为强密码
--       （大小写字母 + 数字组合，长度 ≥ 8）；③个人中心可自助改密；④忘记密码只能由管理员「重置密码」
--       回到初始密码，并在下次登录再次强制改密。
-- 语义：
--   mustChangePassword = true → 该账号只能访问改密接口（其余 API 由 requirePermission fail closed 403）。
--   passwordChangedAt = 最近一次密码变更时间（审计投影；历史数据未知 → NULL）。
-- 存量用户 grandfather（本迁移不追溯强制改密）：既有行一次置 false，之后 DDL 默认值改为 true，
--   使「本迁移之后新建的用户」默认进入强制改密态（API 亦显式写入 true）。
-- 红线：仅 ALTER TABLE ... ADD COLUMN / ALTER COLUMN SET DEFAULT（不重建表、不改既有列、不删列、零回填业务数据）。

ALTER TABLE "User"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3) WITH TIME ZONE;

-- 存量行保持 false（grandfather）；新行默认 true（Prisma @default(true) 与 DB 默认一致，无 drift）
ALTER TABLE "User" ALTER COLUMN "mustChangePassword" SET DEFAULT true;
