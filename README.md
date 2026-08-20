# Linier CRM Management System

Enterprise customer relationship management platform.

## Tech Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS
- Prisma ORM
- PostgreSQL
- pnpm Workspace + Turborepo
- ESLint + Prettier + Husky + lint-staged
- Vitest + Playwright (reserved)
- Swagger/OpenAPI (reserved)

## China Deployment Notes（中国部署适配，ADR-0048）

- **npm registry**：`.npmrc` 已配置 `registry=https://registry.npmmirror.com`（大陆访问 npmjs 慢/超时）；GitHub CI 如需官方源可在 workflow env 覆盖 `NPM_CONFIG_REGISTRY`。
- **Docker 镜像**：基础镜像（node:22-alpine / postgres:16-alpine，Docker Hub）在中国大陆需配置阿里云/腾讯云镜像加速器。
- **时区**：docker-compose 已设 `TZ=Asia/Shanghai`（业务日/日志）；数据存储保持 UTC（GL 期间/业务日边界按东八区解析，ADR-0044）。
- **PostgreSQL 版本**：迁移 0025+ 依赖 PG16 `UNIQUE NULLS NOT DISTINCT`——目标云 PG 须 ≥16（PolarDB PG15/兼容版不支持）。

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Setup environment
cp .env.example .env

# 3. Start database
docker compose up -d postgres

# 4. Run migrations and seed
pnpm db:migrate
pnpm db:seed

# 5. Start development
pnpm dev
```

## Project Structure

```text
nilier-crm/
├── apps/
│   └── web/                 # Next.js application
├── packages/
│   ├── ui/                  # Reusable UI components
│   ├── shared/              # Shared utilities, errors, validators
│   ├── config/              # Environment and app configuration
│   └── types/               # Shared TypeScript types
├── prisma/                  # Prisma schema and migrations
├── docker/                  # Docker configurations
├── scripts/                 # Development and setup scripts
└── docs/                    # Project documentation
```

## Scripts

- `pnpm dev` — Start all apps in development mode
- `pnpm build` — Build all packages and apps
- `pnpm lint` — Run linting
- `pnpm type-check` — Run TypeScript type checking
- `pnpm test` — Run unit tests
- `pnpm test:e2e` — Run end-to-end tests
- `pnpm db:migrate` — Run Prisma migrations
- `pnpm db:seed` — Seed the database
- `pnpm db:studio` — Open Prisma Studio

## License

Private — JINZA TRADING SDN. BHD.
