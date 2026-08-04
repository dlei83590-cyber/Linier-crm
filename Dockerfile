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
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /app/node_modules ./node_modules

# pnpm for Railway pre-deploy command (corepack shim; pinned to repo's packageManager)
RUN corepack enable pnpm && corepack prepare pnpm@9.14.4 --activate

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "apps/web/server.js"]
