# WarehouseLocation_API.md — 库位主数据 CRUD 测试用例

- 日期：2026-08-21
- 模块：warehouse-location（Master-Data CRUD backlog）
- 验证事实源 = GitHub CI + 生产 Runtime smoke（CI-First）

## 1. 认证与权限

| # | 用例 | 输入 | 期望 |
| --- | --- | --- | --- |
| A1 | 无权限 | MEMBER 调 create/delete | 403 FORBIDDEN（MANAGER 已授权 view/create/edit/delete） |
| A2 | SUPER_ADMIN | 全部端点 | 200/201 |

## 2. /api/warehouse-locations

| # | 用例 | 输入 | 期望 |
| --- | --- | --- | --- |
| C1 | POST 创建 | { warehouseId, code, name } | 201；approvalStatus 沿用主数据先例 |
| C2 | POST 仓库不存在 | warehouseId=随机 | 409 NOT_FOUND「所属仓库不存在或已停用」 |
| C3 | POST 同仓库重复 code | 同 warehouseId + code | 409 CONFLICT（@@unique([warehouseId, code])） |
| C4 | POST 缺 warehouseId/code/name | 缺字段 | 400 VALIDATION_ERROR |

## 3. /api/warehouse-locations/:id

| # | 用例 | 输入 | 期望 |
| --- | --- | --- | --- |
| G1 | GET 详情 | id | 200 含 warehouse 摘要 |
| P1 | PATCH 正确 version | { version, name } | 200 version+1 |
| P2 | PATCH 过期 version | 旧 version | 409 VERSION_CONFLICT |
| P3 | PATCH code 与他人冲突 | 同仓库已有 code | 409 CONFLICT |
| D1 | DELETE 无引用 | 无流水/单据引用 | 200 软删；再 GET → 404 |
| D2 | DELETE 被引用 | 有 inventoryMovement/单据行/盘点行/调拨/调整/转换引用 | 409 CONFLICT「已被库存流水/单据/盘点/调拨/调整/转换引用，不能删除（可编辑）」 |
