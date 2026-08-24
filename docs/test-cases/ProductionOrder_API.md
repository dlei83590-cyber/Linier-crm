# ProductionOrder API 测试用例（生产/外协工单）

> 版本：v1 ｜ 日期：2026-08-24 ｜ 关联：ADR-0049 / Item_Sourcing_BOM_Design.md（P-3）
> 权限：production-order:view/create/edit/close/delete（submit/post→:edit，cancel→:close）
> 状态机：DRAFT → SUBMITTED → POSTED / CANCELLED（POSTED 不可逆）

## 契约

- `GET /api/production-orders`：分页 + status/productionType/finishedItemId 过滤
- `POST /api/production-orders`：创建 DRAFT（orderNo=PRD 取号；bomId 时服务端按配方计算物料行；手工模式客户端供行）
- `GET/PATCH/DELETE /api/production-orders/:id`：详情 / 编辑（仅 DRAFT，CAS，行重建）/ 删除（仅 DRAFT 软删）
- `POST /:id/submit`：DRAFT → SUBMITTED
- `POST /:id/post`：SUBMITTED → POSTED（同事务：领料 OUT → 成品 IN + 成本 + 幂等）
- `POST /:id/cancel`：DRAFT/SUBMITTED → CANCELLED

## 用例

### PRD-01 创建（BOM 驱动）
- finishedItem + ACTIVE BOM + plannedQty=100 → 服务端生成原料行（数量 = 系数×数量×损耗率） + 成品行；201

### PRD-02 创建（OEM）
- productionType=OEM_OUTSOURCING + supplierId（供应商类型）+ processingFee=500 → 201；supplierId/processingFee 落库
- 缺 supplierId / 非供应商类型 → 409 PRODUCTION_ORDER_SUPPLIER_INVALID

### PRD-03 单位红线
- 手动物料行 uomId != 物料库存单位 → 409 PRODUCTION_ORDER_UOM_INVALID

### PRD-04 过账成功（同事务）
- SUBMITTED → POSTED：原料行 OUT + 成品 IN（同一 movementGroupId）；成品成本 = Σ原料成本 + OEM 加工费；成品行 unitCost/amount 写入
- 原料无成本层 → 成品成本 = 加工费（OEM）或 0（自产）

### PRD-05 幂等与状态门禁
- POSTED 重复 post → 409 PRODUCTION_ORDER_ALREADY_POSTED
- DRAFT post → 409 PRODUCTION_ORDER_INVALID_STATE（仅 SUBMITTED）
- CAS version 不匹配 → 409 VERSION_CONFLICT

### PRD-06 BOM 需求下限
- 有 BOM 且原料行数量 < 配方需求量（100×0.05×1.02=5.1 > 5）→ 400 PRODUCTION_ORDER_BOM_REQUIREMENT

### PRD-07 库存不足
- 领料 OUT 库存不足 → 409 INVENTORY_INSUFFICIENT_STOCK（事务回滚，工单保持 SUBMITTED）

### PRD-08 取消
- DRAFT/SUBMITTED → CANCELLED；POSTED → 409 PRODUCTION_ORDER_INVALID_STATE
