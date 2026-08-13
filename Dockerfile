# syntax=docker/dockerfile:1
FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json ./packages/ui/
RUN corepack enable pnpm && (test -f pnpm-lock.yaml && pnpm install --frozen-lockfile || pnpm install)

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
# Copy the full deps output so pnpm workspace symlink trees survive:
# root node_modules (.pnpm store) + apps/web/node_modules + packages/*/node_modules
COPY --from=deps /app/ ./
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# Build-time release metadata (P0.5, CTO 16:45 fix):
# - APP_VERSION 由 next.config.ts 从 root package.json 读取（SSOT）。
# - 生产 GIT_SHA/BUILD_ID 的确定来源 = 构建环境平台变量（Railway 构建注入
#   RAILWAY_GIT_COMMIT_SHA / RAILWAY_DEPLOYMENT_ID；GitHub Actions 注入
#   GITHUB_SHA / GITHUB_RUN_ID），由 next.config.ts 在 next build 时直接读取。
#   .dockerignore 排除 .git → 禁止依赖 git rev-parse 作为生产路径。
# - 下方 ARG/ENV 仅为显式覆盖通道（--build-arg 传入时生效）；默认空值，
#   避免把 "unknown" 占位符 bake 进镜像遮蔽平台变量。
ARG NEXT_PUBLIC_GIT_SHA=
ARG NEXT_PUBLIC_BUILD_ID=
ARG NEXT_PUBLIC_DEPLOYMENT_ENV=production
ENV NEXT_PUBLIC_GIT_SHA=$NEXT_PUBLIC_GIT_SHA
ENV NEXT_PUBLIC_BUILD_ID=$NEXT_PUBLIC_BUILD_ID
ENV NEXT_PUBLIC_DEPLOYMENT_ENV=$NEXT_PUBLIC_DEPLOYMENT_ENV
# Generate Prisma Client before building so next build's type check
# can resolve @prisma/client types (matches the CI Build job)
RUN corepack enable pnpm && pnpm db:generate && pnpm build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Next.js standalone runtime
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Prisma migrate/seed tooling for Railway pre-deploy command
# (full workspace node_modules tree so prisma CLI + tsx resolve correctly)
# NOTE: node_modules must come from BUILDER (not deps): the builder ran
# `prisma generate`, so its tree contains the generated Prisma Client.
# Copying the deps tree instead shadows the traced @prisma/client in the
# standalone output with an un-generated copy -> runtime error
# "@prisma/client did not initialize yet".
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/node_modules ./node_modules

# pnpm for Railway pre-deploy command (corepack shim; pinned to repo's packageManager)
# Regenerate Prisma Client in the runner tree as well: guarantees the
# standalone runtime resolves a fully-generated client regardless of what
# Next.js traced into .next/standalone/node_modules.
RUN corepack enable pnpm && corepack prepare pnpm@9.14.4 --activate && pnpm exec prisma generate

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health/ready || exit 1

CMD ["node", "apps/web/server.js"]
