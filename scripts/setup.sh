#!/usr/bin/env bash
set -euo pipefail

echo "[setup] Installing dependencies..."
corepack enable pnpm
pnpm install

echo "[setup] Creating environment file..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "[setup] .env created from .env.example"
else
  echo "[setup] .env already exists, skipping"
fi

echo "[setup] Starting PostgreSQL..."
docker compose up -d postgres

echo "[setup] Waiting for PostgreSQL..."
sleep 5

echo "[setup] Running Prisma migrations..."
pnpm db:migrate

echo "[setup] Seeding database..."
pnpm db:seed

echo "[setup] Done. Run 'pnpm dev' to start development."
