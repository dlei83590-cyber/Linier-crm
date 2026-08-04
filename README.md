# Nilier CRM

Enterprise customer relationship management platform.

## Tech Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS
- Prisma ORM
- PostgreSQL
- pnpm Workspace + Turborepo
- ESLint + Prettier + Husky + lint-staged
- Vitest + Playwright (reserved)
- Swagger/OpenAPI (reserved)

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
