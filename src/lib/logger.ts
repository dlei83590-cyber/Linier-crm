import pino from "pino";
import { getEnvironment } from "@/src/config/env";

const env = getEnvironment();

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "linier-crm", environment: env.NODE_ENV },
  redact: {
    paths: [
      "req.headers.authorization",
      "password",
      "token",
      "accessToken",
      "refreshToken",
    ],
    censor: "[REDACTED]",
  },
});
