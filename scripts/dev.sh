#!/usr/bin/env bash
set -euo pipefail

echo "[dev] Ensuring PostgreSQL is running..."
docker compose up -d postgres

echo "[dev] Starting Turborepo dev..."
pnpm dev
