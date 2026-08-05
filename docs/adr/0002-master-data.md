# ADR-0002: Sprint 2 Master Data 模型设计

- 状态：已接受
- 日期：2026-08-05
- 决策者：CTO（指令转达）+ CIO 执行

## 背景

Sprint 1 已交付认证与 RBAC 基础设施（User/Department/Role/Permission/UserRole/AuditLog）。
Sprint 2 不再做基础设施，直接构建 CRM 数据基础 **Master Data**，供后续
Customer / Quotation / Sales Order / Purchase / Inventory 依赖。

## 决策

按 CTO 指定顺序新增 4 个主数据模型 + 1 个明细模型：

1. **Product（产品）**：code 唯一、name、category、unit、description、isActive
2. **Supplier（供应商）**：code 唯一、name、contactPerson、phone、email、address、isActive
3. **Material（物料）**：code 唯一、name、unit、description、isActive
4. **PriceList（价格表）+ PriceListItem（价格行）**：code 唯一、name、currency（默认 CNY）、
   行项目可关联 Product 或 Material（二选一），unitPrice DECIMAL(12,2)

### 设计原则

- 主数据一律带 `code` 唯一键（业务编码，便于对接导入导出），主键仍用 cuid
- 统一 `isActive` 软停用标记 + `createdAt/updatedAt`（Timestamptz(3)）
- PriceListItem 的 productId/materialId 均可空，但业务上二者取一（应用层约束）
- 外键级联：PriceListItem 随 PriceList/Product/Material 删除而级联删除
- 权限：每个模块新增 `read/write` 两枚权限（product/supplier/material/price-list），
  SUPER_ADMIN 与 ADMIN 自动继承全部权限，MANAGER 获得主数据只读，MEMBER 获得产品/物料只读

## 影响

- 新增迁移 `0002_master_data`
- seed 增加主数据样例（3 产品 / 2 供应商 / 2 物料 / 1 价格表 + 2 行）
- 前端新增 4 个占位页（/products /suppliers /materials /price-lists），
  带 PermissionGuard，菜单按权限过滤

## 后续

Customer / Quotation / Sales Order / Purchase / Inventory 将外键引用上述主数据，
禁止直接引用字符串编码。
