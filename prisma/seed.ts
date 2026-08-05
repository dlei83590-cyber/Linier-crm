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
];

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
    category: "FINISHED_GOOD",
    spec: "轻载荷通用型直线导轨，性价比高",
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
    category: "FINISHED_GOOD",
    spec: "中载荷高刚性法兰型直线导轨",
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
    category: "FINISHED_GOOD",
    spec: "低噪声紧凑型直线导轨",
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
    category: "FINISHED_GOOD",
    spec: "微型紧凑型直线导轨",
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
    category: "FINISHED_GOOD",
    spec: "合同示例：SM 系列，45 规格，双滑块，导轨 1515，轻预压，导轨长度 22.5m（按合同）",
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
  { code: "SO", name: "销售订单", prefix: "SO", nextNo: 1, padLength: 6 },
  { code: "PO", name: "采购订单", prefix: "PO", nextNo: 1, padLength: 6 },
  { code: "QUO", name: "报价单", prefix: "QUO", nextNo: 1, padLength: 6 },
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

  // Permissions
  for (const permission of SEED_PERMISSIONS) {
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

  // Master data: price list (含税/未税/税率/税额)
  const priceList = await prisma.priceList.upsert({
    where: { code: "PL-2026-STD" },
    update: {},
    create: {
      code: "PL-2026-STD",
      name: "2026 标准价格表",
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
