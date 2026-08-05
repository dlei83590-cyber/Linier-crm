# ADR-0002: 中国版主数据模型（Item / BusinessPartner / PriceList / TechnicalStandard）

- 状态：已接受
- 日期：2026-08-05
- 决策者：CIO（依据中国工业企业实际业务资料设计）+ CTO 审核

## 背景

Sprint 1 已交付认证与 RBAC 基础设施（User/Department/Role/Permission/UserRole/AuditLog）。
Sprint 2 按中国工业企业（直线导轨制造与贸易）实际业务资料重构主数据模型。

旧设计（本 ADR 初稿）将产品（Product）、物料（Material）、供应商（Supplier）拆分为
独立表，带来三个问题：

1. **物料口径重复**：成品、原材料、配件、外购件、服务、包装物本质都是"物料"，
   Product 与 Material 字段几乎相同，拆分导致名称/型号/单位重复维护。
2. **往来单位不统一**：同一家企业可能既是客户又是供应商（如外协加工厂），
   客户/供应商分表导致数据重复、关系断裂。
3. **中国业务字段缺失**：统一社会信用代码、纳税人类型、开票信息、含税价格体系、
   审批流等中国企业必需字段无处存放。

## 决策

### 1. Item 统一物料模型

单一 `Item` 表承载全部物料类别（`ItemCategory` 枚举）：

- `FINISHED_GOOD`（成品）/ `RAW_MATERIAL`（原材料）/ `ACCESSORY`（配件）/
  `PURCHASED_PART`（外购件）/ `SERVICE`（服务）/ `PACKAGING`（包装物）
- 通用字段：code（内部编码，唯一）、name（中文名称）、model（型号）、
  mnemonic（助记码）、unitId（计量单位外键）、category 等
- 品类差异通过 **1:1 扩展模型**承载，如 `LinearGuideSpecification`（直线导轨专用规格：
  系列/滑块型式/导轨型式/互换性/精度等级/预压力/导轨长度/额定动静负荷/额定力矩/
  润滑/防尘/材质/硬度/安装方式），避免单表字段膨胀

### 2. BusinessPartner 统一往来单位模型

客户 / 供应商 / 客户兼供应商（`PartnerType`：CUSTOMER / SUPPLIER / BOTH）合一：

- 中国工商字段：`uscc`（统一社会信用代码，唯一）、`taxpayerType`（纳税人类型）
- 法律与注册：`legalRepresentative`（法定代表人）、`registeredAddress`（注册地址）
- 开票与结算：`invoiceInfo`（开票信息）、`bankName`（开户银行）、`bankAccount`（银行账号）、
  `settlementTerms`（结算条款）

### 3. PriceList 含税价格体系

`PriceList` + `PriceListItem`，行项目同时存储：

- `unitPriceExclTax`（未税价）/ `taxRate`（税率）/ `taxAmount`（税额）/ `unitPriceInclTax`（含税价）
- `validFrom` / `validUntil`（报价有效期）、`minOrderQty`（最小起订量）、
  `tieredPricing`（阶梯价，Json）、`freightIncluded`（是否含运费）、`approvalStatus`（审批状态）

**税率不写死**：默认税率通过环境变量 `DEFAULT_TAX_RATE` 配置（默认 13，见 `packages/config/src/app.ts`），
禁止在业务代码中硬编码税率。

### 4. 支撑主数据

- `TechnicalStandard`（技术标准，如 GB/T 17616）+ `ItemStandard`（物料-标准关联）
- `UnitOfMeasure`（计量单位，KG/M/PC/SET/BOX/M2）
- `CommercialTerm`（商业条款，EXW/FOB/CIF/NET30）
- `DocumentSequence`（单据序列，SO/PO/QUO 编号规则）

### 5. 通用审计与软删除

所有主数据统一携带：

- `createdById / updatedById / approvedById`（创建人/修改人/审核人）
- `approvalStatus`（DRAFT/PENDING/APPROVED/REJECTED，默认 DRAFT）
- `version`（版本号，乐观锁）+ `deletedAt`（软删除）
- `isActive`（停用标记）+ `createdAt/updatedAt`（Timestamptz(3)）

### 6. 权限模型

每个主数据模块 `read/write` 两枚权限，SUPER_ADMIN 与 ADMIN 自动继承全部权限，
MANAGER 获得主数据读写，MEMBER 获得 item/business-partner 只读。
（权限常量见 `packages/shared/src/constants/index.ts`）

## 影响

- 迁移 `0002_master_data` 未合并，直接重建为 `0002_master_data_cn`（10 张主数据表）
- seed 增加直线导轨示例（系列 SG/SM/SR/SV，合同示例 `SMH45A-2-R1515-Z0-N-22.5`）与
  客户/供应商/两者兼有示例（含统一社会信用代码）、技术标准、商业条款、单据序列、价格表
- 前端占位页：/items /business-partners /price-lists /technical-standards
  /unit-of-measures /commercial-terms /document-sequences

## 后续

销售/采购/库存/财务业务（Sprint 3+）一律外键引用 Item 与 BusinessPartner，
禁止直接引用字符串编码。
