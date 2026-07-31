#!/usr/bin/env bash
# Deploy manual di VPS (cadangan kalau tidak lewat GitHub Actions).
# Jalankan dari root repo di server: ./scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Pull kode terbaru dari origin/main"
git fetch --all
git reset --hard origin/main

echo "==> Rebuild & restart container"
docker compose up -d --build

echo "==> Bersihkan image lama"
docker image prune -f

echo "==> Status"
docker compose ps
