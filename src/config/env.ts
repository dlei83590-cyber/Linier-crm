import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1).default("linier-crm"),
  JWT_AUDIENCE: z.string().min(1).default("linier-crm-web"),
  JWT_EXPIRES_IN: z.string().min(1).default("15m"),
});

export type Environment = z.infer<typeof schema>;

let environment: Environment | undefined;

export function getEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Environment {
  if (source === process.env && environment) return environment;

  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map(({ path, message }) => `${path.join(".")}: ${message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  if (source === process.env) environment = result.data;
  return result.data;
}
