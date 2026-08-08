import { PrismaClient, Role } from "@prisma/client";
import { hash } from "bcryptjs";
import { taxConfig } from "@nilier-crm/config";

const prisma = new PrismaClient();

const SEED_ROLES: Array<Pick<Role, "name" | "code" | "description">> = [
  { name: "Super Admin", code: "SUPER_ADMIN", description: "Full platform access" },
  { name: "Admin", code: "ADMIN", description: "Workspace administration" },
  { name: "Manager", code: "MANAGER", description: "Manage team and pipelines" },
  { name: "Member", code: "MEMBER", description: "Standard user" },
  { name: "Viewer", code: "VIEWER", description: "Read-only access" },
];

const SEED_PERMISSIONS: Array<{ name: string; code: string; module: string; description?: string }> = [
  { name: "Read users", code: "user:read", module: "user" },
  { name: "Write users", code: "user:write", module: "user" },
  { name: "Read roles", code: "role:read", module: "role" },
  { name: "Write roles", code: "role:write", module: "role" },
  { name: "Read audit logs", code: "audit:read", module: "audit" },
  { name: "Write audit logs", code: "audit:write", module: "audit" },
  { name: "Read items", code: "item:read", module: "item" },
  { name: "Write items", code: "item:write", module: "item" },
  { name: "Read business partners", code: "business-partner:read", module: "business-partner" },
  { name: "Write business partners", code: "business-partner:write", module: "business-partner" },
  { name: "Read price lists", code: "price-list:read", module: "price-list" },
  { name: "Write price lists", code: "price-list:write", module: "price-list" },
  { name: "Read technical standards", code: "technical-standard:read", module: "technical-standard" },
  { name: "Write technical standards", code: "technical-standard:write", module: "technical-standard" },
  { name: "Read units of measure", code: "unit-of-measure:read", module: "unit-of-measure" },
  { name: "Write units of measure", code: "unit-of-measure:write", module: "unit-of-measure" },
  { name: "Read commercial terms", code: "commercial-term:read", module: "commercial-term" },
  { name: "Write commercial terms", code: "commercial-term:write", module: "commercial-term" },
  { name: "Read document sequences", code: "document-sequence:read", module: "document-sequence" },
  { name: "Write document sequences", code: "document-sequence:write", module: "document-sequence" },
  { name: "Read project opportunities", code: "project-opportunity:read", module: "project-opportunity" },
  { name: "Write project opportunities", code: "project-opportunity:write", module: "project-opportunity" },
  { name: "Read projects", code: "project:read", module: "project" },
  { name: "Write projects", code: "project:write", module: "project" },
  { name: "Read project visits", code: "project-visit:read", module: "project-visit" },
  { name: "Write project visits", code: "project-visit:write", module: "project-visit" },
  { name: "Read project risks", code: "project-risk:read", module: "project-risk" },
  { name: "Write project risks", code: "project-risk:write", module: "project-risk" },
];

/** 细粒度动作级权限（view/create/edit/delete/approve/audit/export/import/assign/close），供审批流直接复用 */
const SEED_ACTION_MODULES = [
  "user",
  "role",
  "audit",
  "item",
  "business-partner",
  "price-list",
  // Sprint 3C-4：Price Foundation 模块
  "price-policy",
  "price-rule",
  "price-list-version",
  "partner-price",
  "promotion",
  "tax-profile",
  "tax-rate",
  "exchange-rate",
  "pricing-engine",
  "price-audit",
  "technical-standard",
  "unit-of-measure",
  "commercial-term",
  "document-sequence",
  "project-opportunity",
  "project",
  "project-visit",
  "project-risk",
  // Sprint 3C-5：Project Foundation 子资源模块
  "project-stakeholder",
  "project-member",
  "project-milestone",
  "project-task",
  "project-budget",
  "project-expense",
  "project-product",
  "project-progress",
  "project-acceptance",
  "project-closure",
  "project-tag",
  "project-attachment",
  // Sprint 4A：Quotation Foundation 模块
  "quotation",
  "quotation-line",
  "quotation-revision",
  "quotation-snapshot",
  "approval-policy",
  "approval-policy-rule",
  // Sprint 4B：Sales Order Foundation 模块
  "sales-order",
  "sales-order-line",
  "sales-order-revision",
  "sales-order-snapshot",
  // Sprint 4C：Delivery Foundation 模块（动作映射：ready/dispatch→edit；confirm-delivery→approve；cancel→close）
  "delivery",
  "delivery-line",
  "delivery-revision",
  "delivery-snapshot",
  // Sprint 4D：Invoice Foundation 模块（动作映射：create→invoice:create；issue→invoice:approve；cancel draft→invoice:close；line 系统生成仅 view/edit 语义；revision/snapshot 只读）
  "invoice",
  "invoice-line",
  "invoice-revision",
  "invoice-snapshot",
  // Sprint 4E-1：Accounts Receivable Foundation 模块（动作映射：view→accounts-receivable:view；revision/snapshot 只读 view；金额由 4E-2 Receipt/4E-3 CN-DN 动作驱动，本阶段无 create/edit 入口）
  "accounts-receivable",
  "accounts-receivable-revision",
  "accounts-receivable-snapshot",
  // Sprint 4E-2：Receipt & Payment Allocation 模块（动作映射：create→receipt:create（创建即取号）；allocate/reverse→receipt:edit；void→receipt:close；write-off create/submit/approve/apply→write-off:create/edit/approve；revision/snapshot 只读 view）
  "receipt",
  "receipt-allocation",
  "receipt-revision",
  "receipt-snapshot",
  "write-off",
  "write-off-allocation",
  // Sprint 3A：平台底座模块
  "workflow-definition",
  "workflow-step",
  "workflow-condition",
  "workflow-instance",
  "workflow-action",
  "workflow-history",
  "approver",
  "approver-group",
  "approval-delegate",
  "approval-escalation",
  "approval-timeout",
  "approval-reminder",
  "notification-template",
  "notification-message",
  "notification-channel",
  "notification-log",
  "dictionary-type",
  "dictionary-item",
  "system-setting",
  "tenant-setting",
  "user-setting",
] as const;

const SEED_ACTIONS = ["view", "create", "edit", "delete", "approve", "audit", "export", "import", "assign", "close"] as const;

const SEED_ACTION_PERMISSIONS: Array<{ name: string; code: string; module: string }> = SEED_ACTION_MODULES.flatMap((module) =>
  SEED_ACTIONS.map((action) => ({ name: `${action} ${module}`, code: `${module}:${action}`, module })),
);

const SEED_UNITS = [
  { code: "KG", name: "千克", symbol: "kg" },
  { code: "M", name: "米", symbol: "m" },
  { code: "PC", name: "件", symbol: "件" },
  { code: "SET", name: "套", symbol: "套" },
  { code: "BOX", name: "盒", symbol: "盒" },
  { code: "M2", name: "平方米", symbol: "m²" },
];

/** 直线导轨系列示例（SG / SM / SR / SV），以及合同示例 SMH45A-2-R1515-Z0-N-22.5 */
const SEED_LINEAR_GUIDE_ITEMS = [
  {
    code: "LG-SG45",
    mnemonic: "SG45",
    name: "直线导轨副 SG45",
    model: "SG45",
    itemType: "FINISHED_GOOD",
    spec: "轻载荷通用型直线导轨，性价比高",
    brand: 'JINZA',
    manufacturer: 'JINZA 精密机械',
    oemCode: 'JZ-SG45',
    drawingNo: 'JZ-DWG-SG45',
    drawingVersion: 'A1',
    lifecycle: 'MASS_PRODUCTION',
    minPackQty: 10,
    procurementLeadTime: 15,
    moq: 50,
    safetyStock: 200,
    linearGuide: {
      series: "SG",
      slideBlockType: "法兰型",
      railType: "45",
      interchangeability: "可互换",
      precisionGrade: "C3",
      preload: "轻预压",
      railLength: 2000,
      ratedDynamicLoad: 38.0,
      ratedStaticLoad: 45.0,
      ratedMoment: { MR: 380, MP: 330, MY: 330 },
      lubrication: "锂基润滑脂",
      dustProtection: "端面密封",
      material: "轴承钢 GCr15",
      hardness: "HRC 58-62",
      mountingType: "螺栓安装",
    },
  },
  {
    code: "LG-SM45H",
    mnemonic: "SM45H",
    name: "直线导轨副 SM45H",
    model: "SM45H",
    itemType: "FINISHED_GOOD",
    spec: "中载荷高刚性法兰型直线导轨",
    brand: 'JINZA',
    manufacturer: 'JINZA 精密机械',
    oemCode: 'JZ-SM45H',
    drawingNo: 'JZ-DWG-SM45H',
    drawingVersion: 'A2',
    lifecycle: 'TRIAL',
    minPackQty: 10,
    procurementLeadTime: 20,
    moq: 50,
    safetyStock: 300,
    linearGuide: {
      series: "SM",
      slideBlockType: "法兰型",
      railType: "45",
      interchangeability: "可互换",
      precisionGrade: "C3",
      preload: "中预压",
      railLength: 2000,
      ratedDynamicLoad: 42.0,
      ratedStaticLoad: 50.0,
      ratedMoment: { MR: 420, MP: 360, MY: 360 },
      lubrication: "锂基润滑脂",
      dustProtection: "端面密封+刮屑板",
      material: "轴承钢 GCr15",
      hardness: "HRC 58-62",
      mountingType: "螺栓安装",
    },
  },
  {
    code: "LG-SR35",
    mnemonic: "SR35",
    name: "直线导轨副 SR35",
    model: "SR35",
    itemType: "FINISHED_GOOD",
    spec: "低噪声紧凑型直线导轨",
    brand: 'JINZA',
    manufacturer: 'JINZA 精密机械',
    oemCode: 'JZ-SR35',
    drawingNo: 'JZ-DWG-SR35',
    drawingVersion: 'A1',
    lifecycle: 'MASS_PRODUCTION',
    minPackQty: 20,
    procurementLeadTime: 10,
    moq: 100,
    safetyStock: 500,
    linearGuide: {
      series: "SR",
      slideBlockType: "方型",
      railType: "35",
      interchangeability: "可互换",
      precisionGrade: "C3",
      preload: "轻预压",
      railLength: 1500,
      ratedDynamicLoad: 30.0,
      ratedStaticLoad: 36.0,
      ratedMoment: { MR: 300, MP: 260, MY: 260 },
      lubrication: "锂基润滑脂",
      dustProtection: "端面密封",
      material: "轴承钢 GCr15",
      hardness: "HRC 58-62",
      mountingType: "螺栓安装",
    },
  },
  {
    code: "LG-SV25",
    mnemonic: "SV25",
    name: "直线导轨副 SV25",
    model: "SV25",
    itemType: "FINISHED_GOOD",
    spec: "微型紧凑型直线导轨",
    brand: 'JINZA',
    manufacturer: 'JINZA 精密机械',
    oemCode: 'JZ-SV25',
    drawingNo: 'JZ-DWG-SV25',
    drawingVersion: 'A0',
    lifecycle: 'DESIGN',
    minPackQty: 20,
    procurementLeadTime: 25,
    moq: 100,
    safetyStock: 400,
    linearGuide: {
      series: "SV",
      slideBlockType: "方型",
      railType: "25",
      interchangeability: "可互换",
      precisionGrade: "C3",
      preload: "轻预压",
      railLength: 1000,
      ratedDynamicLoad: 18.0,
      ratedStaticLoad: 22.0,
      ratedMoment: { MR: 180, MP: 150, MY: 150 },
      lubrication: "锂基润滑脂",
      dustProtection: "端面密封",
      material: "轴承钢 GCr15",
      hardness: "HRC 58-62",
      mountingType: "螺栓安装",
    },
  },
  {
    code: "LG-SMH45A-2-R1515-Z0-N-22.5",
    mnemonic: "SMH45A",
    name: "直线导轨副 SMH45A-2-R1515-Z0-N-22.5",
    model: "SMH45A-2-R1515-Z0-N-22.5",
    itemType: "FINISHED_GOOD",
    spec: "合同示例：SM 系列，45 规格，双滑块，导轨 1515，轻预压，导轨长度 22.5m（按合同）",
    brand: 'JINZA',
    manufacturer: 'JINZA 精密机械',
    oemCode: 'JZ-SMH45A-2-R1515',
    drawingNo: 'JZ-DWG-SMH45A',
    drawingVersion: 'B1',
    lifecycle: 'TRIAL',
    minPackQty: 10,
    procurementLeadTime: 30,
    moq: 20,
    safetyStock: 100,
    linearGuide: {
      series: "SM",
      slideBlockType: "H 型（高刚性法兰型）",
      railType: "R1515",
      interchangeability: "不可互换（配对）",
      precisionGrade: "C5",
      preload: "Z0（轻预压）",
      railLength: 22500,
      ratedDynamicLoad: 45.0,
      ratedStaticLoad: 53.0,
      ratedMoment: { MR: 450, MP: 390, MY: 390 },
      lubrication: "润滑脂（客户指定）",
      dustProtection: "N（耐尘密封）",
      material: "轴承钢 GCr15",
      hardness: "HRC 58-62",
      mountingType: "螺栓安装",
    },
  },
];

const SEED_BUSINESS_PARTNERS = [
  {
    code: "BP-C-0001",
    mnemonic: "客户A",
    name: "某机床制造有限公司",
    shortName: "某机床",
    fullName: "某机床制造有限公司",
    groupName: "某机床集团",
    region: "华东",
    industry: "机床制造",
    companySize: "中型",
    creditRating: "A",
    sourceChannel: "展会",
    foundedDate: new Date("2005-03-15T00:00:00Z"),
    registeredCapital: 5000,
    employeeCount: 350,
    website: "https://www.machine-a.cn",
    wechatOfficialAccount: "某机床官方号",
    tags: ["重点客户", "设备制造商"],
    type: "CUSTOMER",
    uscc: "91310000MA1K123456",
    taxpayerType: "一般纳税人",
    legalRepresentative: "张某",
    registeredAddress: "上海市嘉定区××路1号",
    invoiceInfo: { title: "某机床制造有限公司", taxNo: "91310000MA1K123456" },
    bankName: "工商银行上海嘉定支行",
    bankAccount: "100012345678901",
    settlementTerms: "月结30天",
    contactPerson: "王采购",
    phone: "021-88880001",
    email: "buy@machine-a.cn",
    address: "上海市嘉定区××路1号",
  },
  {
    code: "BP-S-0001",
    mnemonic: "供应商A",
    name: "华南轴承科技有限公司",
    shortName: "华南轴承",
    fullName: "华南轴承科技有限公司",
    groupName: "华南轴承集团",
    region: "华南",
    industry: "轴承制造",
    companySize: "大型",
    creditRating: "AA",
    sourceChannel: "行业推荐",
    foundedDate: new Date("1998-07-01T00:00:00Z"),
    registeredCapital: 12000,
    employeeCount: 1200,
    website: "https://www.hn-bearing.cn",
    wechatOfficialAccount: "华南轴承",
    tags: ["核心供应商", "ISO9001"],
    type: "SUPPLIER",
    uscc: "91440300MA5A12345X",
    taxpayerType: "一般纳税人",
    legalRepresentative: "李某",
    registeredAddress: "深圳市宝安区××工业园",
    invoiceInfo: { title: "华南轴承科技有限公司", taxNo: "91440300MA5A12345X" },
    bankName: "招商银行深圳宝安支行",
    bankAccount: "755912345678901",
    settlementTerms: "货到付款",
    contactPerson: "陈工",
    phone: "0755-88880002",
    email: "sales@hn-bearing.cn",
    address: "深圳市宝安区××工业园",
  },
  {
    code: "BP-B-0001",
    mnemonic: "兼营伙伴",
    name: "华东机电贸易有限公司",
    shortName: "华东机电",
    fullName: "华东机电贸易有限公司",
    groupName: "华东机电集团",
    region: "华东",
    industry: "机电贸易",
    companySize: "小型",
    creditRating: "B",
    sourceChannel: "老客户转介绍",
    foundedDate: new Date("2015-11-20T00:00:00Z"),
    registeredCapital: 800,
    employeeCount: 45,
    website: "https://www.hd-mech.cn",
    wechatOfficialAccount: "华东机电贸易",
    tags: ["客户兼供应商", "贸易商"],
    type: "BOTH",
    uscc: "91320594MA1B123456",
    taxpayerType: "小规模纳税人",
    legalRepresentative: "赵某",
    registeredAddress: "苏州市工业园区××路2号",
    invoiceInfo: { title: "华东机电贸易有限公司", taxNo: "91320594MA1B123456" },
    bankName: "建设银行苏州园区支行",
    bankAccount: "3220199887654321",
    settlementTerms: "月结60天",
    contactPerson: "刘经理",
    phone: "0512-88880003",
    email: "trade@hd-mech.cn",
    address: "苏州市工业园区××路2号",
  },
];

const SEED_TECHNICAL_STANDARDS = [
  { code: "GB/T 17616", name: "直线运动滚动支承-滚动导轨副", description: "直线导轨副国家标准" },
  { code: "GB/T 12345", name: "机械安全通用要求", description: "机械安全通用要求（示例）" },
];

const SEED_COMMERCIAL_TERMS = [
  { code: "EXW", name: "工厂交货", description: "Ex Works" },
  { code: "FOB", name: "船上交货", description: "Free On Board" },
  { code: "CIF", name: "成本加保险费加运费", description: "Cost, Insurance and Freight" },
  { code: "NET30", name: "月结30天", description: "Net 30 days" },
];

const SEED_DOCUMENT_SEQUENCES = [
  { code: "QUO", name: "报价单", docType: "QUOTATION", prefix: "QT", nextNo: 1, padLength: 6 },
  { code: "SO", name: "销售订单", docType: "SALES_ORDER", prefix: "SO", nextNo: 1, padLength: 6 },
  { code: "PO", name: "采购订单", docType: "PURCHASE_ORDER", prefix: "PO", nextNo: 1, padLength: 6 },
  { code: "PI", name: "形式发票", docType: "PROFORMA_INVOICE", prefix: "PI", nextNo: 1, padLength: 6 },
  { code: "CI", name: "商业发票", docType: "COMMERCIAL_INVOICE", prefix: "CI", nextNo: 1, padLength: 6 },
  // Sprint 4C：Delivery Foundation 单据序列（CTO 锁定：DELIVERY_ORDER / prefix DO / padLength 6；幂等 upsert）
  { code: "DO", name: "送货单", docType: "DELIVERY_ORDER", prefix: "DO", nextNo: 1, padLength: 6 },
  { code: "GRN", name: "收货单", docType: "GOODS_RECEIPT_NOTE", prefix: "GRN", nextNo: 1, padLength: 6 },
  { code: "GI", name: "出库单", docType: "GOODS_ISSUE", prefix: "GI", nextNo: 1, padLength: 6 },
  // Sprint 4D：Invoice Foundation 单据序列（CTO Review 必改①：DRAFT 不占号，仅 ISSUE 时取号 INV-2026-000123；幂等 upsert）
  { code: "INV", name: "发票", docType: "INVOICE", prefix: "INV", nextNo: 1, padLength: 6 },
  // Sprint 4E-3：Credit Note / Debit Note 单据序列（复用 4D 已建序列——docType=CREDIT_NOTE/DEBIT_NOTE 与 CN-/DN-2026-xxxx 前缀均已存在，**不重复新增**；CTO 拍板：CN/DN 为两个正式单据类型，编号/审计/法务税务展示区分）
  { code: "CN", name: "贷项通知单", docType: "CREDIT_NOTE", prefix: "CN", nextNo: 1, padLength: 6 },
  { code: "DN", name: "借项通知单", docType: "DEBIT_NOTE", prefix: "DN", nextNo: 1, padLength: 6 },
  { code: "PV", name: "付款凭证", docType: "PAYMENT_VOUCHER", prefix: "PV", nextNo: 1, padLength: 6 },
  { code: "RCT", name: "收款收据", docType: "RECEIPT", prefix: "RCT", nextNo: 1, padLength: 6 },
  // Sprint 4E-2：WriteOff 单据序列（CTO Design Review 拍板④：创建即取号 WO-2026-xxxx；幂等 upsert）
  { code: "WO", name: "坏账核销", docType: "WRITE_OFF", prefix: "WO", nextNo: 1, padLength: 6 },
  { code: "EXP", name: "费用报销", docType: "EXPENSE", prefix: "EXP", nextNo: 1, padLength: 6 },
  { code: "JRN", name: "日记账", docType: "JOURNAL", prefix: "JRN", nextNo: 1, padLength: 6 },
  { code: "CT", name: "合同", docType: "CONTRACT", prefix: "CT", nextNo: 1, padLength: 6 },
  { code: "PJ", name: "项目", docType: "PROJECT", prefix: "PJ", nextNo: 1, padLength: 6 },
];

/** Sprint 3A：工作流定义示例（Workflow Foundation） */
const SEED_WORKFLOW_DEFINITIONS = [
  {
    code: "QUOTATION_APPROVAL",
    name: "报价审批",
    module: "quotation",
    version: 1,
    status: "ACTIVE",
    description: "报价单审批流：金额 > 100000 需总监审批",
    steps: [
      {
        stepNo: 1,
        stepName: "销售经理审批",
        approverType: "ROLE",
        approverValue: "MANAGER",
        approvalMode: "SEQUENTIAL",
        timeoutHours: 24,
        allowReject: true,
        allowTransfer: true,
        allowDelegate: true,
        allowWithdraw: false,
        conditions: [],
      },
      {
        stepNo: 2,
        stepName: "销售总监审批",
        approverType: "ROLE",
        approverValue: "DIRECTOR",
        approvalMode: "SEQUENTIAL",
        timeoutHours: 48,
        allowReject: true,
        allowTransfer: true,
        allowDelegate: true,
        allowWithdraw: false,
        conditions: [{ field: "amount", operator: "GT", value: "100000" }],
      },
    ],
  },
  {
    code: "EXPENSE_APPROVAL",
    name: "费用报销审批",
    module: "expense",
    version: 1,
    status: "ACTIVE",
    description: "费用报销审批流：部门负责人 → 财务",
    steps: [
      {
        stepNo: 1,
        stepName: "部门负责人审批",
        approverType: "DEPARTMENT",
        approverValue: "ENG",
        approvalMode: "SEQUENTIAL",
        timeoutHours: 24,
        allowReject: true,
        allowTransfer: false,
        allowDelegate: true,
        allowWithdraw: false,
        conditions: [],
      },
      {
        stepNo: 2,
        stepName: "财务审批",
        approverType: "ROLE",
        approverValue: "FINANCE",
        approvalMode: "SEQUENTIAL",
        timeoutHours: 48,
        allowReject: true,
        allowTransfer: true,
        allowDelegate: false,
        allowWithdraw: false,
        conditions: [{ field: "department", "operator": "EQ", value: "Sales" }],
      },
    ],
  },
];

/** Sprint 4A：报价审批策略（Quotation Foundation；ApprovalPolicy 只负责选择 Workflow，不执行审批） */
// Sprint 4E-3：CN/DN 采用条件审批（ApprovalPolicy module=CREDIT_DEBIT_NOTE，复用现有策略机制，不建 Approval 表）；
// 按 4E-2 WriteOff 先例**不自动建默认审批策略**（策略由用户按需配置；无策略时 SUBMITTED 后可直接 Apply）
const SEED_APPROVAL_POLICIES: Array<{
  code: string;
  name: string;
  module: string;
  priority: number;
  enabled: boolean;
  rules: Array<{
    minAmount: number | null;
    maxAmount: number | null;
    priority: number;
    workflowDefinitionCode: string;
  }>;
}> = [
  {
    code: "QUOTATION_DEFAULT",
    name: "报价默认审批策略",
    module: "QUOTATION",
    priority: 100,
    enabled: true,
    rules: [
      // < 50,000 CNY → Sales Manager（QUOTATION_APPROVAL 流程）
      { minAmount: null, maxAmount: 50000, priority: 300, workflowDefinitionCode: "QUOTATION_APPROVAL" },
      // 50,000–200,000 CNY → Department Manager
      { minAmount: 50000, maxAmount: 200000, priority: 200, workflowDefinitionCode: "QUOTATION_APPROVAL" },
      // > 200,000 CNY → General Manager
      { minAmount: 200000, maxAmount: null, priority: 100, workflowDefinitionCode: "QUOTATION_APPROVAL" },
    ],
  },
];

/** Sprint 3A：审批组示例 */
const SEED_APPROVER_GROUPS = [
  { code: "DIRECTORS", name: "总监组", description: "各业务线总监" },
  { code: "FINANCE", name: "财务组", description: "财务审批人" },
];


/** Sprint 3B：菜单组 */
const SEED_MENU_GROUPS = [
  { code: "DASHBOARD", name: "仪表盘", icon: "LayoutDashboard", sort: 1 },
  { code: "MASTER_DATA", name: "主数据", icon: "Database", sort: 2 },
  { code: "PROJECT", name: "项目管理", icon: "Briefcase", sort: 3 },
  { code: "WORKFLOW", name: "工作流", icon: "GitBranch", sort: 4 },
  { code: "SYSTEM", name: "系统设置", icon: "Settings", sort: 99 },
];

/** Sprint 3B：菜单（含 RouteMeta：icon/sort/hidden/cache/externalLink/permission） */
const SEED_MENUS = [
  { code: "dashboard", name: "数据总览", groupCode: "DASHBOARD", path: "/dashboard", icon: "LayoutDashboard", sort: 1 },
  { code: "items", name: "物料管理", groupCode: "MASTER_DATA", path: "/items", icon: "Boxes", sort: 1, permission: "item:view" },
  { code: "business-partners", name: "往来单位", groupCode: "MASTER_DATA", path: "/business-partners", icon: "Building2", sort: 2, permission: "business-partner:view" },
  { code: "price-lists", name: "价格表", groupCode: "MASTER_DATA", path: "/price-lists", icon: "Tags", sort: 3, permission: "price-list:view" },
  { code: "projects", name: "项目", groupCode: "PROJECT", path: "/projects", icon: "FolderKanban", sort: 1, permission: "project:view" },
  { code: "project-opportunities", name: "销售机会", groupCode: "PROJECT", path: "/project-opportunities", icon: "Target", sort: 2, permission: "project-opportunity:view" },
  { code: "workflow-definitions", name: "流程定义", groupCode: "WORKFLOW", path: "/workflows/definitions", icon: "GitBranch", sort: 1, permission: "workflow-definition:view" },
  { code: "workflow-instances", name: "审批实例", groupCode: "WORKFLOW", path: "/workflows/instances", icon: "ClipboardList", sort: 2, permission: "workflow-instance:view" },
  { code: "dictionaries", name: "字典管理", groupCode: "SYSTEM", path: "/dictionaries", icon: "BookOpen", sort: 1, permission: "dictionary-type:view" },
  { code: "settings", name: "参数设置", groupCode: "SYSTEM", path: "/settings", icon: "Settings2", sort: 2, permission: "system-setting:view" },
  { code: "audit-logs", name: "审计日志", groupCode: "SYSTEM", path: "/audit-logs", icon: "ShieldCheck", sort: 3, permission: "audit:view" },
];


/** Sprint 3C-1：行业（Customer Foundation） */
const SEED_INDUSTRIES = [
  { code: "MACHINERY", name: "机械制造", sort: 1 },
  { code: "AUTO", name: "汽车零部件", sort: 2 },
  { code: "ELECTRONICS", name: "电子电器", sort: 3 },
  { code: "METALLURGY", name: "冶金材料", sort: 4 },
  { code: "MEDICAL", name: "医疗器械", sort: 5 },
  { code: "AEROSPACE", name: "航空航天", sort: 6 },
];

/** Sprint 3C-1：标签 */
const SEED_TAGS = [
  { code: "KEY_ACCOUNT", name: "重点客户", color: "#e74c3c", sort: 1 },
  { code: "NEW_CUSTOMER", name: "新客户", color: "#2ecc71", sort: 2 },
  { code: "VIP", name: "VIP", color: "#f39c12", sort: 3 },
  { code: "COOPERATING", name: "合作中", color: "#3498db", sort: 4 },
];

/** Sprint 3C-2：供应商（关联既有 BusinessPartner，type=SUPPLIER/BOTH） */
const SEED_SUPPLIERS = [
  { code: "SUP-0001", name: "华南轴承科技有限公司", partnerCode: "BP-S-0001", status: "QUALIFIED", rating: 5, defaultLeadTime: 15, minOrderQty: 100, currency: "CNY", isPreferred: true },
  { code: "SUP-0002", name: "华东机电贸易有限公司", partnerCode: "BP-B-0001", status: "PREFERRED", rating: 4, defaultLeadTime: 20, minOrderQty: 50, currency: "CNY", isPreferred: true },
];

/** Sprint 3C-2：Partner 角色（BusinessPartnerRole，BusinessPartner 唯一主体） */
const SEED_PARTNER_ROLES = [
  { partnerCode: "BP-C-0001", roleType: "CUSTOMER" },
  { partnerCode: "BP-S-0001", roleType: "SUPPLIER" },
  { partnerCode: "BP-B-0001", roleType: "BOTH" },
];

// ============ Sprint 3C-4 Price Foundation（CTO #2360：业务规则首次进入 Seed，严格幂等）============

/** 价格策略（code 唯一 + upsert + 幂等；policyType 取现有枚举，code 为业务唯一键） */
const SEED_PRICE_POLICIES = [
  { code: "STANDARD_PRICE", name: "标准价", policyType: "STANDARD", priority: 100, matchStrategy: "HIGHEST_PRIORITY", stopOnMatch: true, description: "标准销售价（价目表兜底）" },
  { code: "VIP_PRICE", name: "VIP 客户价", policyType: "VIP", priority: 90, matchStrategy: "HIGHEST_PRIORITY", stopOnMatch: true, description: "VIP 客户专属价" },
  { code: "PROJECT_PRICE", name: "项目价", policyType: "PROJECT", priority: 80, matchStrategy: "HIGHEST_PRIORITY", stopOnMatch: true, description: "工程项目价" },
  { code: "SUPPLIER_PRICE", name: "供应商价", policyType: "DEALER", priority: 70, matchStrategy: "HIGHEST_PRIORITY", stopOnMatch: true, description: "供应商/渠道价（DEALER 枚举近似）" },
  { code: "PURCHASE_PRICE", name: "采购价", policyType: "STANDARD", priority: 60, matchStrategy: "HIGHEST_PRIORITY", stopOnMatch: true, description: "采购标准价（枚举无 PURCHASE，以 STANDARD 近似）" },
  { code: "PROMOTION_PRICE", name: "促销价", policyType: "PROMOTION", priority: 50, matchStrategy: "HIGHEST_PRIORITY", stopOnMatch: true, description: "促销价（优先级最高）" },
];

/** 价格规则示例（CTO #2360：至少 Quantity/VIP/Region 三条，不空数据；ruleType 与 schema 枚举一致） */
const SEED_PRICE_RULES = [
  { policyCode: "STANDARD_PRICE", ruleType: "QUANTITY_BREAK", ruleName: "数量≥100 享 5% 折扣", conditions: { minQty: 100 }, discountRate: 5, priority: 100, description: "Quantity >= 100 → 5% Discount" },
  { policyCode: "VIP_PRICE", ruleType: "CUSTOMER_LEVEL", ruleName: "VIP 客户价", conditions: { customerLevel: "VIP" }, discountRate: 0, priority: 100, description: "Customer Level = VIP → VIP Price" },
  { policyCode: "PROJECT_PRICE", ruleType: "REGION", ruleName: "华东区域价", conditions: { region: "East China" }, discountRate: 0, priority: 100, description: "Region = East China → Regional Price" },
];

/** 税率档案（多国复用：中国 13% / 马来西亚 SST / 新加坡 GST） */
const SEED_TAX_PROFILES = [
  { code: "CN_VAT_13", name: "中国增值税 13%", country: "CN", region: null, taxIncluded: false, rateType: "THIRTEEN", rate: 13 },
  { code: "MY_SST", name: "马来西亚销售与服务税", country: "MY", region: null, taxIncluded: false, rateType: "CUSTOM", rate: 8 },
  { code: "SG_GST", name: "新加坡消费税", country: "SG", region: null, taxIncluded: false, rateType: "CUSTOM", rate: 9 },
];

/** 汇率示例（base/quote/effectiveDate 复合唯一；来源：PBOC 央行 / ECB / Manual 人工） */
const SEED_EXCHANGE_RATES = [
  { baseCurrency: "USD", quoteCurrency: "CNY", rate: 7.1, effectiveDate: new Date("2026-08-06T00:00:00Z"), provider: "PBOC", source: "央行", rateType: "CENTRAL_BANK", manualOverride: false },
  { baseCurrency: "CNY", quoteCurrency: "USD", rate: 0.1408, effectiveDate: new Date("2026-08-06T00:00:00Z"), provider: "PBOC", source: "央行", rateType: "CENTRAL_BANK", manualOverride: false },
  { baseCurrency: "MYR", quoteCurrency: "CNY", rate: 1.65, effectiveDate: new Date("2026-08-06T00:00:00Z"), provider: "ECB", source: "ECB", rateType: "CENTRAL_BANK", manualOverride: false },
  { baseCurrency: "CNY", quoteCurrency: "MYR", rate: 0.606, effectiveDate: new Date("2026-08-06T00:00:00Z"), provider: "ECB", source: "ECB", rateType: "CENTRAL_BANK", manualOverride: false },
  { baseCurrency: "SGD", quoteCurrency: "CNY", rate: 5.35, effectiveDate: new Date("2026-08-06T00:00:00Z"), provider: "Manual", source: "人工", rateType: "MANUAL", manualOverride: true },
  { baseCurrency: "CNY", quoteCurrency: "SGD", rate: 0.187, effectiveDate: new Date("2026-08-06T00:00:00Z"), provider: "Manual", source: "人工", rateType: "MANUAL", manualOverride: true },
];

/** 促销示例（Demo Promotion，保持简单） */
const SEED_PROMOTIONS = [
  { code: "PROMO-DEMO-2026", name: "Demo Promotion", promotionType: "PERCENT", discountValue: 10, startAt: new Date("2026-08-01T00:00:00Z"), endAt: new Date("2026-12-31T23:59:59Z"), priority: 100, stackable: false, exclusive: false, priceSource: "PROMOTION", status: "ACTIVE", description: "演示促销：全场 10%" },
];

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@linier.com";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
  const passwordHash = await hash(password, 12);
  const defaultTaxRate = taxConfig.defaultRate; // 默认税率来自配置（默认 13），不写死

  // Departments
  const engineering = await prisma.department.upsert({
    where: { code: "ENG" },
    update: {},
    create: { name: "Engineering", code: "ENG" },
  });

  // Roles
  const roleMap = new Map<string, string>();
  for (const role of SEED_ROLES) {
    const saved = await prisma.role.upsert({
      where: { code: role.code },
      update: {},
      create: role,
    });
    roleMap.set(role.code, saved.id);
  }

  // Permissions (read/write + 动作级)
  for (const permission of [...SEED_PERMISSIONS, ...SEED_ACTION_PERMISSIONS]) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: {},
      create: permission,
    });
  }

  // Admin user
  const adminName = process.env.SEED_ADMIN_NAME ?? "管理员";
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name: adminName },
    create: {
      email,
      passwordHash,
      name: adminName,
      departmentId: engineering.id,
    },
  });

  // Link admin user to SUPER_ADMIN role
  const superAdminRoleId = roleMap.get("SUPER_ADMIN");
  if (superAdminRoleId) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: superAdminRoleId } },
      update: {},
      create: { userId: user.id, roleId: superAdminRoleId },
    });
  }

  // Master data: units of measure
  const unitMap = new Map<string, string>();
  for (const u of SEED_UNITS) {
    const saved = await prisma.unitOfMeasure.upsert({
      where: { code: u.code },
      update: {},
      create: u,
    });
    unitMap.set(u.code, saved.id);
  }

  // Master data: items (linear guide series)
  const itemCodes: string[] = [];
  for (const item of SEED_LINEAR_GUIDE_ITEMS) {
    const { linearGuide, ...base } = item;
    const saved = await prisma.item.upsert({
      where: { code: base.code },
      update: {},
      create: {
        ...base,
        unitId: unitMap.get("SET"),
      },
    });
    itemCodes.push(base.code);
    if (linearGuide) {
      await prisma.linearGuideSpecification.upsert({
        where: { itemId: saved.id },
        update: {},
        create: { itemId: saved.id, ...linearGuide },
      });
    }
  }

  // Master data: business partners
  const partnerCodes: string[] = [];
  for (const p of SEED_BUSINESS_PARTNERS) {
    await prisma.businessPartner.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    });
    partnerCodes.push(p.code);
  }

  // Master data: technical standards
  for (const s of SEED_TECHNICAL_STANDARDS) {
    await prisma.technicalStandard.upsert({
      where: { code: s.code },
      update: {},
      create: s,
    });
  }

  // Master data: commercial terms
  for (const t of SEED_COMMERCIAL_TERMS) {
    await prisma.commercialTerm.upsert({
      where: { code: t.code },
      update: {},
      create: t,
    });
  }

  // Master data: document sequences
  for (const d of SEED_DOCUMENT_SEQUENCES) {
    await prisma.documentSequence.upsert({
      where: { code: d.code },
      update: {},
      create: d,
    });
  }

  // Sprint 3A: workflow definitions (Workflow Foundation)
  for (const wf of SEED_WORKFLOW_DEFINITIONS) {
    const { steps, ...definition } = wf;
    const savedWf = await prisma.workflowDefinition.upsert({
      where: { code: definition.code },
      update: {},
      create: definition,
    });
    await prisma.workflowStep.deleteMany({ where: { definitionId: savedWf.id } });
    for (const step of steps) {
      const { conditions, ...stepData } = step;
      const savedStep = await prisma.workflowStep.create({
        data: { ...stepData, definitionId: savedWf.id },
      });
      for (const cond of conditions) {
        await prisma.workflowCondition.create({ data: { ...cond, stepId: savedStep.id } });
      }
    }
  }

  // Sprint 4A: approval policies（Quotation Foundation；只选择 Workflow，不执行审批；幂等：稳定 code + upsert + 重建 rules）
  for (const policy of SEED_APPROVAL_POLICIES) {
    const { rules, ...policyData } = policy;
    const savedPolicy = await prisma.approvalPolicy.upsert({
      where: { code: policyData.code },
      update: {},
      create: { ...policyData, approvalStatus: "APPROVED" },
    });
    await prisma.approvalPolicyRule.deleteMany({ where: { policyId: savedPolicy.id } });
    for (const rule of rules) {
      const wf = await prisma.workflowDefinition.findFirst({ where: { code: rule.workflowDefinitionCode, deletedAt: null } });
      if (!wf) continue;
      await prisma.approvalPolicyRule.create({
        data: {
          policyId: savedPolicy.id,
          minAmount: rule.minAmount,
          maxAmount: rule.maxAmount,
          priority: rule.priority,
          workflowDefinitionId: wf.id,
          approvalStatus: "APPROVED",
        },
      });
    }
  }

  // Sprint 3A: approver groups
  for (const g of SEED_APPROVER_GROUPS) {
    await prisma.approverGroup.upsert({
      where: { code: g.code },
      update: {},
      create: g,
    });
  }

  // Sprint 3B: menu groups + menus（幂等：稳定 code + upsert，菜单按 code 重建子项）
  // Sprint 3C-1: industries + tags（幂等：稳定 code + upsert）
  for (const ind of SEED_INDUSTRIES) {
    await prisma.industry.upsert({
      where: { code: ind.code },
      update: {},
      create: ind,
    });
  }
  for (const t of SEED_TAGS) {
    await prisma.tag.upsert({
      where: { code: t.code },
      update: {},
      create: t,
    });
  }

  // Sprint 3C-2: partner roles（BusinessPartnerRole，BusinessPartner 唯一主体；幂等：稳定 code + upsert）
  for (const r of SEED_PARTNER_ROLES) {
    const bp = await prisma.businessPartner.findFirst({ where: { code: r.partnerCode, deletedAt: null } });
    if (!bp) continue;
    await prisma.businessPartnerRole.upsert({
      where: { partnerId_roleType: { partnerId: bp.id, roleType: r.roleType as never } },
      update: {},
      create: { partnerId: bp.id, roleType: r.roleType as never },
    });
  }

  // Sprint 3C-2: suppliers（关联既有 BusinessPartner，type=SUPPLIER/BOTH；幂等：稳定 code + upsert）
  for (const s of SEED_SUPPLIERS) {
    const bp = await prisma.businessPartner.findFirst({ where: { code: s.partnerCode, deletedAt: null } });
    if (!bp) continue;
    await prisma.supplier.upsert({
      where: { code: s.code },
      update: {},
      create: {
        code: s.code,
        name: s.name,
        partnerId: bp.id,
        status: s.status as never,
        rating: s.rating,
        defaultLeadTime: s.defaultLeadTime,
        minOrderQty: s.minOrderQty,
        currency: s.currency,
        isPreferred: s.isPreferred,
      },
    });
  }

  const menuGroupIds = new Map<string, string>();
  for (const g of SEED_MENU_GROUPS) {
    const saved = await prisma.menuGroup.upsert({
      where: { code: g.code },
      update: {},
      create: g,
    });
    menuGroupIds.set(g.code, saved.id);
  }
  for (const m of SEED_MENUS) {
    const groupId = menuGroupIds.get(m.groupCode);
    if (!groupId) continue;
    const saved = await prisma.menu.upsert({
      where: { code: m.code },
      update: {},
      create: {
        code: m.code,
        name: m.name,
        groupId,
        path: m.path ?? null,
        icon: m.icon ?? null,
        sort: m.sort ?? 0,
        hidden: m.hidden ?? false,
        cache: m.cache ?? false,
        externalLink: m.externalLink ?? null,
        permission: m.permission ?? null,
      },
    });
    void saved;
  }

  // Master data: price list (含税/未税/税率/税额)
  const priceList = await prisma.priceList.upsert({
    where: { code: "PL-2026-STD" },
    update: {},
    create: {
      code: "PL-2026-STD",
      name: "2026 标准价格表",
      priceType: "SALES",
      currency: "CNY",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: new Date("2026-12-31T23:59:59Z"),
      freightIncluded: false,
      approvalStatus: "APPROVED",
    },
  });
  // 幂等重建价格行
  await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
  for (const code of itemCodes.slice(0, 3)) {
    const item = await prisma.item.findUnique({ where: { code } });
    if (!item) continue;
    const unitPriceExclTax = code.includes("SMH45A") ? 3200 : 1200;
    const taxAmount = Number((unitPriceExclTax * defaultTaxRate / 100).toFixed(4));
    const unitPriceInclTax = Number((unitPriceExclTax + taxAmount).toFixed(4));
    await prisma.priceListItem.create({
      data: {
        priceListId: priceList.id,
        itemId: item.id,
        unitPriceExclTax,
        taxRate: defaultTaxRate,
        taxAmount,
        unitPriceInclTax,
        minOrderQty: 1,
        approvalStatus: "APPROVED",
      },
    });
  }

  // Sprint 3C-4: price policies（幂等：code 唯一 + upsert）
  const pricePolicyMap = new Map<string, string>();
  for (const p of SEED_PRICE_POLICIES) {
    const saved = await prisma.pricePolicy.upsert({
      where: { code: p.code },
      update: {},
      create: {
        code: p.code,
        name: p.name,
        policyType: p.policyType as never,
        priority: p.priority,
        matchStrategy: p.matchStrategy as never,
        stopOnMatch: p.stopOnMatch,
        description: p.description,
        approvalStatus: "APPROVED",
      },
    });
    pricePolicyMap.set(p.code, saved.id);
  }

  // Sprint 3C-4: price rules（幂等：policyId + ruleName 存在则跳过）
  for (const r of SEED_PRICE_RULES) {
    const policyId = pricePolicyMap.get(r.policyCode);
    if (!policyId) continue;
    const exists = await prisma.priceRule.findFirst({
      where: { policyId, ruleName: r.ruleName, deletedAt: null },
    });
    if (exists) continue;
    await prisma.priceRule.create({
      data: {
        policyId,
        ruleType: r.ruleType as never,
        ruleName: r.ruleName,
        conditions: r.conditions as object,
        discountRate: r.discountRate,
        priority: r.priority,
        approvalStatus: "APPROVED",
      },
    });
  }

  // Sprint 3C-4: tax profiles + rates（幂等：code 唯一 + upsert）
  for (const t of SEED_TAX_PROFILES) {
    const saved = await prisma.taxProfile.upsert({
      where: { code: t.code },
      update: {},
      create: {
        code: t.code,
        name: t.name,
        country: t.country,
        region: t.region,
        taxIncluded: t.taxIncluded,
        rateType: t.rateType as never,
        rate: t.rate,
        approvalStatus: "APPROVED",
      },
    });
    const rateExists = await prisma.taxRate.findFirst({
      where: { taxProfileId: saved.id, rate: t.rate, deletedAt: null },
    });
    if (!rateExists) {
      await prisma.taxRate.create({
        data: {
          taxProfileId: saved.id,
          rate: t.rate,
          effectiveFrom: new Date("2026-01-01T00:00:00Z"),
          isActive: true,
          approvalStatus: "APPROVED",
        },
      });
    }
  }

  // Sprint 3C-4: exchange rates（幂等：复合唯一键 upsert）
  for (const e of SEED_EXCHANGE_RATES) {
    await prisma.exchangeRate.upsert({
      where: {
        baseCurrency_quoteCurrency_effectiveDate: {
          baseCurrency: e.baseCurrency,
          quoteCurrency: e.quoteCurrency,
          effectiveDate: e.effectiveDate,
        },
      },
      update: {},
      create: {
        baseCurrency: e.baseCurrency,
        quoteCurrency: e.quoteCurrency,
        rate: e.rate,
        effectiveDate: e.effectiveDate,
        provider: e.provider,
        source: e.source,
        rateType: e.rateType as never,
        manualOverride: e.manualOverride,
        approvalStatus: "APPROVED",
      },
    });
  }

  // Sprint 3C-4: promotions（幂等：code 唯一 + upsert）
  for (const p of SEED_PROMOTIONS) {
    await prisma.promotionRule.upsert({
      where: { code: p.code },
      update: {},
      create: {
        code: p.code,
        name: p.name,
        promotionType: p.promotionType as never,
        discountValue: p.discountValue,
        startAt: p.startAt,
        endAt: p.endAt,
        priority: p.priority,
        stackable: p.stackable,
        exclusive: p.exclusive,
        priceSource: p.priceSource as never,
        status: p.status,
        approvalStatus: "APPROVED",
      },
    });
  }

  console.log(
    `[seed] user=${email} role=SUPER_ADMIN department=ENG taxRate=${defaultTaxRate}% ` +
      `items=${itemCodes.length} partners=${partnerCodes.length} units=${SEED_UNITS.length}`,
  );
}

main()
  .catch((error) => {
    console.error("[seed] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
