import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.infrastructureSetting.upsert({
    where: { key: "schema_version" },
    update: { value: "0.1.0" },
    create: { key: "schema_version", value: "0.1.0" },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
