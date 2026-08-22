const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.$queryRawUnsafe("SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at DESC");
  console.log("MIG_COUNT=" + rows.length);
  console.log("MIG_DATA=" + JSON.stringify(rows.map(r => r.migration_name + "|" + (r.finished_at ? "done" : "PENDING") + "|" + (r.rolled_back_at ? "rolledback" : "active"))));
}
main().catch(e => { console.error("ERR=" + e.message); process.exit(1); }).finally(() => prisma.$disconnect());
