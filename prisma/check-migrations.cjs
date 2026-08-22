// 诊断：查看 _prisma_migrations 状态（0043-0046 是否 failed）
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.$queryRawUnsafe("SELECT migration_name, finished_at, rolled_back_at, logs FROM _prisma_migrations ORDER BY started_at DESC LIMIT 15");
  console.log("MIGRATIONS:");
  rows.forEach(r => console.log(JSON.stringify({ name: r.migration_name, finished: r.finished_at, rolledBack: r.rolled_back_at, logs: (r.logs || "").slice(0, 100) })));
}
main().catch(e => { console.error("ERR", e.message); process.exit(1); }).finally(() => prisma.$disconnect());
