import { PrismaClient, Role } from "@prisma/client";
import { hash } from "bcryptjs";

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
  { name: "Read products", code: "product:read", module: "product" },
  { name: "Write products", code: "product:write", module: "product" },
  { name: "Read suppliers", code: "supplier:read", module: "supplier" },
  { name: "Write suppliers", code: "supplier:write", module: "supplier" },
  { name: "Read materials", code: "material:read", module: "material" },
  { name: "Write materials", code: "material:write", module: "material" },
  { name: "Read price lists", code: "price-list:read", module: "price-list" },
  { name: "Write price lists", code: "price-list:write", module: "price-list" },
];

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@linier.com";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
  const passwordHash = await hash(password, 12);

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

  // Master data: products
  const products = [
    { code: "P-0001", name: "铝合金型材 6063-T5", category: "铝型材", unit: "kg" },
    { code: "P-0002", name: "不锈钢板材 304", category: "板材", unit: "张" },
    { code: "P-0003", name: "钢化玻璃 5mm", category: "玻璃", unit: "m²" },
  ];
  for (const p of products) {
    await prisma.product.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    });
  }

  // Master data: suppliers
  const suppliers = [
    { code: "S-0001", name: "华南铝业有限公司", contactPerson: "陈工", phone: "020-88888888", email: "sales@hn-al.com" },
    { code: "S-0002", name: "新钢集团", contactPerson: "李经理", phone: "021-66666666", email: "sales@xingang.com" },
  ];
  for (const s of suppliers) {
    await prisma.supplier.upsert({
      where: { code: s.code },
      update: {},
      create: s,
    });
  }

  // Master data: materials
  const materials = [
    { code: "M-0001", name: "硅酮密封胶", unit: "支" },
    { code: "M-0002", name: "自攻螺丝 ST4.2", unit: "盒" },
  ];
  for (const m of materials) {
    await prisma.material.upsert({
      where: { code: m.code },
      update: {},
      create: m,
    });
  }

  // Master data: price list
  const priceList = await prisma.priceList.upsert({
    where: { code: "PL-2026-STD" },
    update: {},
    create: { code: "PL-2026-STD", name: "2026 标准价格表", currency: "CNY" },
  });
  // 幂等重建价格行（避免 upsert 自定义 id 重复创建）
  await prisma.priceListItem.deleteMany({ where: { priceListId: priceList.id } });
  const productP0001 = await prisma.product.findUnique({ where: { code: "P-0001" } });
  const materialM0001 = await prisma.material.findUnique({ where: { code: "M-0001" } });
  if (productP0001) {
    await prisma.priceListItem.create({
      data: { priceListId: priceList.id, productId: productP0001.id, unitPrice: 25.5 },
    });
  }
  if (materialM0001) {
    await prisma.priceListItem.create({
      data: { priceListId: priceList.id, materialId: materialM0001.id, unitPrice: 8.9 },
    });
  }

  console.log(`[seed] user=${email} role=SUPER_ADMIN department=ENG masterData=products:${products.length},suppliers:${suppliers.length},materials:${materials.length}`);
}

main()
  .catch((error) => {
    console.error("[seed] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
