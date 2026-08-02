# Linier CRM Management System

利尼尔 CRM 管理系统的 Sprint 1 基础设施工程。

## Prerequisites

- Node.js 22
- npm
- Docker with Docker Compose

## Local setup

```bash
cp .env.example .env
npm install
docker compose up -d postgres
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

Open `http://localhost:3000`, health at `/api/v1/health`, and Swagger at `/api-docs`.

## Quality checks

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run swagger
npm run jwt
npm run rbac
npm run build
```

Sprint 1 contains infrastructure only. Customer, Supplier, Quotation, Order, Product, and Report modules are deferred.
