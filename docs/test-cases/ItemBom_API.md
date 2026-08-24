# ItemBom API 测试用例（配方——物料组合固定配方）

> 版本：v1 ｜ 日期：2026-08-24 ｜ 关联：ADR-0049 / Item_Sourcing_BOM_Design.md（P-2）
> 权限：bom:view / bom:create / bom:edit / bom:approve / bom:delete

## 契约

- `GET /api/boms`：分页 + finishedItemId/status 过滤
- `POST /api/boms`：创建 DRAFT（bomVersion = max+1；bomNo = BOM-{成品code}-{version} 自动生成）
- `GET/PATCH/DELETE /api/boms/:id`：详情 / 编辑（仅 DRAFT，CAS，行整体重建）/ 删除（仅 DRAFT 软删）
- `POST /api/boms/:id/activate`：DRAFT/ARCHIVED → ACTIVE + isDefault（同成品其他 ACTIVE 置 ARCHIVED）

## 用例

### BOM-01 创建
- 成品 + 2 行原料（吨/公斤，系数 + 损耗率）→ 201；bomNo 正确；status=DRAFT；bomVersion=1

### BOM-02 单位红线
- Given 原料 stockUomId = 吨，提交 componentUomId = 件 → 409 BOM_LINE_INVALID（单位必须 = 原料库存单位）

### BOM-03 原料等于成品 / 重复
- componentItemId == finishedItemId → 409 BOM_LINE_INVALID
- 同配方内同原料两行 → 409 BOM_COMPONENT_DUPLICATE

### BOM-04 多版本
- 同成品第二次创建 → bomVersion=2；bomNo=BOM-{code}-2

### BOM-05 激活唯一性
- 激活 v2 → v2 ACTIVE+isDefault；v1 自动 ARCHIVED
- 重复激活 ACTIVE 配方 → 409 BOM_ALREADY_ACTIVE

### BOM-06 编辑/删除状态门禁
- PATCH/DELETE 非 DRAFT → 409 BOM_INVALID_STATE；CAS version 不匹配 → 409 VERSION_CONFLICT

### BOM-07 需求计算（系数）
- 成品数 100、系数 0.05、损耗率 0.02 → 需求量 = 100 × 0.05 × 1.02 = 5.1（供工单 POST 校验）
