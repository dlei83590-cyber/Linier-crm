export const databaseConfig = {
  provider: "postgresql" as const,
  connectionString: process.env.DATABASE_URL ?? "",
};
