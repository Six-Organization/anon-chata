# ---- Stage 1: build ----
FROM node:20-alpine AS builder
WORKDIR /app

# env publik harus tersedia SAAT build (di-inline ke bundle browser)
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SOCKET_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_SOCKET_URL=${NEXT_PUBLIC_SOCKET_URL}

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Stage 2: production (standalone) ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# output "standalone" Next.js: server minimal + node_modules terpakai saja
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
