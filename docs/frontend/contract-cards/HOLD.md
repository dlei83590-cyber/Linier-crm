# Contract Card — HOLD 汇总（Backend Contract Missing / 未开放）

- 判定规则：**Backend Contract Missing → HOLD**（无 FINAL read/write API 路由）
- 行为：导航显示"尚未开放"，不可点击；不开放任何操作
- 事实基线：apps/web/src/app/api 实际路由（2026-08-14 核验）
- 前端禁止为这些模块发明端点 / 拼装 API / 自行计算权威事实

---

## 往来单位 business-partners

- 能力：NONE
- API 事实：无统一 read/write 路由（仅 `/api/business-partners/{id}/roles` 子资源）；
  现存 `/api/customers`、`/api/suppliers` 为分离主体，尚无 unified BusinessPartner API
- Permission：`business-partner:view` 等已 seed（RBAC 已注册），但端点缺失
- Gap：待后端统一 BusinessPartner API 契约（或前端按 Customer/Supplier 分域开放决策）

## 技术标准 technical-standards

- 能力：NONE；无 API 路由（permission 已 seed）
- Gap：待后端契约

## 商业条款 commercial-terms

- 能力：NONE；无 API 路由（permission 已 seed）
- Gap：待后端契约

## 单据序列 document-sequences

- 能力：NONE；无 API 路由（permission 已 seed）
- Gap：待后端契约

## 用户管理 users / 部门管理 departments / 角色权限 roles

- 能力：NONE；无 API 路由（permission 已 seed）
- Gap：待后端契约（当前认证走 `/api/auth/me`，管理面 API 未实现）

## 客户走访 project-visits / 项目风险 project-risks

- 能力：NONE；无 API 路由
- Gap：待后端契约；F2-4 中作为 Project Detail Workspace Tabs 的子资源规划
  （不开放独立 Sidebar 入口）

## 库存展望 stock-projection / 库存流水 inventory-ledger

- 能力：NONE；无 FINAL Read API（`/api/inventory-ledger/consume` 为消耗端，非列表读模型）
- 红线：**禁止** SUM Movement / 拼 Operations API / 前端自行推 onHand
- Gap：F2-7 正式后端 Read API Gate 后开放

## 应付未结项 ap-open-items

- 能力：NONE；无 API 路由
- Gap：待后端契约（5C AP 域扩展）

## 供应商贷项/借项 supplier-cn-dn

- 能力：NONE；无 API 路由、无独立 permission（禁止复用销售侧 CREDIT_DEBIT_NOTE_READ）
- Gap：5C-2 正式批准（Design/Schema/API 定义）后开放

## 付款核销 payment-allocation

- 能力：NONE；无 API 路由
- Gap：5C-2 正式批准后开放

## 报表中心 reports

- 能力：NONE；无 API 路由（指标未定义）
- Gap：Catalog 见 docs/frontend/Report_Catalog.md；指标定义后另行规划
