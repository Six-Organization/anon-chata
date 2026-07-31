#!/bin/sh
set -e

echo "[be] Menjalankan prisma migrate deploy..."
npx prisma migrate deploy

echo "[be] Memulai server..."
exec node dist/index.js
