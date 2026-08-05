export const appConfig = {
  name: "Linier CRM Management System",
  version: "0.1.0",
  defaultLocale: "zh-CN",
  supportedLocales: ["zh-CN", "en"],
} as const;

/**
 * 税务配置：默认税率（%）。
 * 通过环境变量 DEFAULT_TAX_RATE 配置，默认 13；禁止在业务代码中硬编码税率。
 */
export const taxConfig = {
  defaultRate: Number(process.env.DEFAULT_TAX_RATE ?? 13),
} as const;
