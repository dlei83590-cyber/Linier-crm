FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM dependencies AS builder
COPY . .
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV JWT_SECRET=build-only-secret-at-least-thirty-two-characters
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
