# Anon Chat — Anonymous 3-Person Group Chat

Web app group chat **anonim**, maksimal **3 orang per room**, **realtime** (Socket.IO), tanpa registrasi.
Monorepo dengan pemisahan tegas **Backend (`be/`)** dan **Frontend (`fe/`)**.

- **Backend:** Node.js + TypeScript + Express + Socket.IO + Prisma + PostgreSQL
- **Frontend:** Next.js (App Router) + TypeScript + Tailwind + socket.io-client
- **Deploy:** Docker Compose + Nginx (reverse proxy + WebSocket) + Certbot (HTTPS)

> Kontrak BE↔FE (REST + Socket) ada di **[`CLAUDE.md`](CLAUDE.md)** — baca itu dulu kalau mau ubah API.

---

## Struktur Folder

```
.
├── CLAUDE.md              # kontrak API/Socket + aturan arsitektur (source of truth)
├── docker-compose.yml     # postgres + be + fe + nginx
├── nginx/default.conf     # reverse proxy /api & /socket.io -> be, sisanya -> fe
├── be/                    # Backend
│   ├── prisma/            # schema + migrations
│   ├── src/               # app.ts, index.ts, socket.ts, routes/, services/, utils/
│   ├── Dockerfile
│   └── entrypoint.sh      # prisma migrate deploy + start
└── fe/                    # Frontend (Next.js)
    ├── src/app/           # landing (page.tsx) + room/[code]/page.tsx
    ├── src/lib/           # api.ts, socket.ts, types.ts
    └── Dockerfile
```

---

## A. Menjalankan Lokal (dev, BE & FE terpisah)

Butuh **Node 20+** dan **PostgreSQL** yang berjalan.

### 1. Backend

```bash
cd be
cp .env.example .env
# edit .env -> DATABASE_URL sesuai Postgres lokal kamu

npm install
npx prisma migrate dev      # buat tabel (butuh Postgres hidup)
npm run dev                 # http://localhost:4000
```

> Tidak punya Postgres lokal? Jalankan cepat via Docker:
> ```bash
> docker run --name chat-pg -e POSTGRES_USER=chat -e POSTGRES_PASSWORD=chatpass \
>   -e POSTGRES_DB=chatdb -p 5432:5432 -d postgres:16-alpine
> ```

### 2. Frontend

```bash
cd fe
cp .env.example .env.local
# default sudah menunjuk ke http://localhost:4000

npm install
npm run dev                 # http://localhost:3000
```

Buka <http://localhost:3000>, buat room, salin kode, buka di tab/perangkat lain untuk uji realtime.

---

## B. Menjalankan dengan Docker (lokal, semua sekaligus)

```bash
docker compose up -d --build
```

- Frontend + Backend diakses lewat **Nginx** di <http://localhost> (port 80).
- Nginx merutekan `/api` & `/socket.io` ke backend, sisanya ke Next.js.
- Migrasi Prisma jalan otomatis saat container `be` start (`entrypoint.sh`).
- Postgres pakai healthcheck; `be` menunggu DB siap sebelum start.

Berhenti: `docker compose down` (data tetap di volume `pgdata`).
Reset total termasuk data: `docker compose down -v`.

### Konfigurasi Docker (opsional)
Override via environment saat `up` atau file `.env` di root:

| Var | Default | Fungsi |
|-----|---------|--------|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `chat` / `chatpass` / `chatdb` | kredensial DB |
| `CORS_ORIGIN` | `*` | origin FE yang diizinkan BE (aman `*` karena same-origin via Nginx, tanpa cookie) |
| `NEXT_PUBLIC_API_URL` | `/api` | base REST (same-origin) |
| `NEXT_PUBLIC_SOCKET_URL` | _(kosong)_ | socket same-origin (default origin halaman) |

> **Penting:** `NEXT_PUBLIC_*` di-inline saat **build image FE**. Kalau mengubahnya, rebuild:
> `docker compose up -d --build fe`.

---

## C. Deploy ke VPS (Ubuntu fresh) — langkah demi langkah

### 1. Install Docker + Compose plugin
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 2. Clone & konfigurasi
```bash
git clone <URL_REPO> chat-web
cd chat-web

# (disarankan) buat .env root untuk kredensial produksi
cat > .env <<'EOF'
POSTGRES_USER=chat
POSTGRES_PASSWORD=ganti-password-kuat
POSTGRES_DB=chatdb
CORS_ORIGIN=*
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_SOCKET_URL=
EOF
```

### 3. Arahkan domain
Buat **A record** DNS `your-domain.com` → IP VPS. Tunggu propagasi.
Edit `nginx/default.conf`, ganti `server_name _;` menjadi `server_name your-domain.com;`.

### 4. Jalankan
```bash
docker compose up -d --build
```
Cek: `docker compose ps` dan `docker compose logs -f be`.
Sekarang situs bisa diakses di `http://your-domain.com`.

### 5. HTTPS via Let's Encrypt / Certbot

**Cara paling ringkas (Certbot standalone, sekali jalan):**
Karena Nginx berada di container dan memakai port 80, gunakan webroot ACME.

1. Aktifkan blok ACME di `nginx/default.conf` dan mount volume webroot.
   Uncomment di `nginx/default.conf`:
   ```nginx
   location /.well-known/acme-challenge/ {
       root /var/www/certbot;
   }
   ```
   Dan di `docker-compose.yml` service `nginx`, uncomment:
   ```yaml
   - ./nginx/certbot/www:/var/www/certbot:ro
   - /etc/letsencrypt:/etc/letsencrypt:ro
   ports:
     - "443:443"
   ```
   Lalu `docker compose up -d nginx`.

2. Minta sertifikat memakai Certbot (di host):
   ```bash
   sudo apt-get install -y certbot
   sudo mkdir -p ./nginx/certbot/www
   sudo certbot certonly --webroot -w ./nginx/certbot/www \
     -d your-domain.com --email you@example.com --agree-tos --no-eff-email
   ```

3. Aktifkan server block `443` di `nginx/default.conf` (contoh sudah disediakan
   di bagian bawah file — salin semua `location` dari block port 80), lalu:
   ```bash
   docker compose restart nginx
   ```

4. Auto-renew (cron host):
   ```bash
   echo "0 3 * * * root certbot renew --webroot -w /path/chat-web/nginx/certbot/www --quiet && docker compose -f /path/chat-web/docker-compose.yml restart nginx" \
     | sudo tee /etc/cron.d/certbot-renew
   ```

> **Alternatif lebih simpel:** pasang Nginx + Certbot langsung di host (bukan container),
> jadikan reverse proxy ke `fe`/`be` yang di-expose ke `127.0.0.1`, lalu
> `sudo certbot --nginx -d your-domain.com` mengurus sertifikat + renew otomatis.

### 6. Update aplikasi
```bash
git pull
docker compose up -d --build
```

---

## Ringkasan Fitur

- Landing: input nickname (opsional → nama acak), **Buat Room** / **Gabung Room** (kode 6 char).
- Room: daftar pesan auto-scroll, indikator online (max 3), notif join/leave, indikator mengetik, tombol keluar, tombol salin kode.
- Realtime broadcast pesan instan; history tersimpan di PostgreSQL (tetap ada saat reconnect).
- **Enforcement max 3 orang di level BE** (event socket `join_room`), bukan cuma UI.
- Reconnect otomatis (socket.io-client) — auto re-join room saat koneksi balik.

## D. CI/CD dengan GitHub Actions

Workflow: [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml).

- **CI** (setiap push & PR): build/type-check Backend (`prisma generate` + `tsc`) dan Frontend (`next build`).
- **CD** (push ke `main`, setelah CI hijau): SSH ke VPS → `git reset --hard origin/main` → `docker compose up -d --build` → prune image lama.

### Prasyarat di VPS (sekali saja)
1. VPS sudah punya Docker + Compose (lihat bagian C.1) dan repo hasil `git clone`.
2. Buat `.env` produksi di root repo VPS (password kuat, `WEB_PORT=80`):
   ```bash
   cat > .env <<'EOF'
   WEB_PORT=80
   POSTGRES_USER=chat
   POSTGRES_PASSWORD=ganti-password-kuat
   POSTGRES_DB=chatdb
   CORS_ORIGIN=*
   NEXT_PUBLIC_API_URL=/api
   NEXT_PUBLIC_SOCKET_URL=
   EOF
   ```
3. Pastikan user SSH bisa menjalankan `docker` tanpa sudo (`sudo usermod -aG docker $USER`, lalu re-login).
4. (Disarankan) tambah swap kalau RAM VPS ≤1 GB, karena `next build` cukup berat:
   ```bash
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

### Secrets GitHub (Settings → Secrets and variables → Actions)
| Secret | Contoh | Fungsi |
|--------|--------|--------|
| `SSH_HOST` | `203.0.113.10` | IP/host VPS |
| `SSH_USER` | `deploy` | user SSH di VPS |
| `SSH_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----…` | private key (public key-nya ada di `~/.ssh/authorized_keys` VPS) |
| `SSH_PORT` | `22` | opsional (default 22) |
| `APP_DIR` | `/home/deploy/chat-web` | path repo di VPS |

> Buat key khusus deploy: `ssh-keygen -t ed25519 -f deploy_key -C "gha-deploy"`.
> Isi `deploy_key.pub` ke `~/.ssh/authorized_keys` di VPS, dan `deploy_key` (privat) ke secret `SSH_KEY`.

Setelah secrets terpasang, tiap `git push` ke `main` otomatis men-deploy. Deploy manual: buka tab **Actions → CI/CD → Run workflow**, atau di VPS jalankan `./scripts/deploy.sh`.

## Troubleshooting singkat
- **`be` restart terus / gagal migrate:** cek `docker compose logs be`; pastikan Postgres healthy (`docker compose ps`).
- **Socket tidak connect di prod:** pastikan Nginx meneruskan header `Upgrade`/`Connection` (sudah ada di `nginx/default.conf`).
- **Ubah `NEXT_PUBLIC_*` tidak berefek:** rebuild image FE (`docker compose up -d --build fe`).
