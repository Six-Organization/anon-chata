# CLAUDE.md — Anonymous 3-Person Group Chat

> **Single source of truth untuk kontrak Backend ↔ Frontend.**
> Kalau kamu (atau Claude Code) mengubah API/Socket contract, **update file ini DULU**,
> baru sesuaikan `be/` dan `fe/` supaya konsisten. **FE TIDAK BOLEH akses DB langsung.**

---

## 1. Overview Arsitektur

Monorepo dengan pemisahan tegas antara Backend dan Frontend:

```
/ (root)
├── CLAUDE.md            # kontrak BE<->FE (file ini)
├── docker-compose.yml   # orkestrasi: postgres, be, fe, nginx
├── nginx/               # reverse proxy + WebSocket upgrade
├── be/                  # Backend  (Express + Socket.IO + Prisma + PostgreSQL)
└── fe/                  # Frontend (Next.js App Router + Tailwind + socket.io-client)
```

| Layer | Tanggung jawab | Tidak boleh |
|-------|----------------|-------------|
| `be/` | REST API, Socket.IO server, semua logika bisnis, akses DB (Prisma), enforcement max 3 orang | — |
| `fe/` | UI (Next.js), panggil REST + Socket.IO milik BE, render pesan | Akses DB / Prisma langsung |

**Alur data:** FE → (REST untuk operasi non-realtime + Socket.IO untuk pesan live) → BE → PostgreSQL.

**Prinsip:** Semua aturan (validasi, room penuh, persist) di-enforce di BE. FE hanya presentasi + optimasi UX.

---

## 2. API Contract (REST)

`NEXT_PUBLIC_API_URL` = **origin server BE** (mis. `http://localhost:4000` di lokal; **kosong** = same-origin via Nginx di prod). FE selalu menambahkan prefix `/api` sendiri.
Semua endpoint di-prefix `/api`. Body/response **JSON**, kecuali upload gambar (multipart).

### `GET /api/health`
Health check.
- **200** → `{ "status": "ok" }`

### `POST /api/rooms`
Buat room baru.
- Request body: _(kosong)_
- **201** → `{ "code": "AB3K9F" }`  — kode 6 karakter, shareable.

### `POST /api/rooms/:code/join`
Cek apakah bisa join room (validasi HTTP; join realtime tetap lewat socket `join_room`).
- Request body: `{ "nickname": string }` (opsional; kosong → nama random di server)
- **200** → `{ "code": string, "participants": Participant[], "nickname": string }`
- **404** → `{ "error": "Room tidak ditemukan" }`
- **409** → `{ "error": "Room penuh" }` (sudah 3 peserta aktif)
- **400** → `{ "error": "<pesan validasi>" }`

### `GET /api/rooms/:code`
Info room + peserta aktif.
- **200** → `{ "code": string, "participants": Participant[], "count": number }`
- **404** → `{ "error": "Room tidak ditemukan" }`

### `GET /api/rooms/:code/messages`
History pesan (urut lama → baru, dibatasi 200 terakhir).
- **200** → `{ "messages": Message[] }`
- **404** → `{ "error": "Room tidak ditemukan" }`

### `POST /api/rooms/:code/upload`
Upload satu gambar (multipart/form-data, field `image`). Disimpan di filesystem BE.
- Batas: mime `image/jpeg|png|gif|webp`, ukuran ≤ 5 MB.
- **201** → `{ "imageUrl": "/api/uploads/<file>" }` — dipakai FE untuk emit `send_message`.
- **400** → `{ "error": "File harus berupa gambar" }` / validasi lain
- **404** → `{ "error": "Room tidak ditemukan" }`
- **413** → `{ "error": "Gambar terlalu besar (maks 5MB)" }`

Gambar disajikan statis di `GET /api/uploads/<file>`. **Auto-hapus permanen 24 jam** setelah dikirim
(file + row pesan gambar dihapus oleh cleanup job di BE) agar tidak memenuhi disk.

### Tipe bersama
```ts
type Participant = {
  id: string;
  nickname: string;
  lastReadAt: string | null; // ISO; waktu terakhir peserta ini "membaca" room
};
type Message = {
  id: string;
  nickname: string;
  content: string;                 // teks / caption (boleh "" untuk gambar)
  type: "text" | "image";
  imageUrl: string | null;         // path gambar bila type=image (null jika sudah kadaluarsa)
  createdAt: string /* ISO */;
};
```

---

## 3. Socket Contract (realtime, Socket.IO)

URL: `NEXT_PUBLIC_SOCKET_URL` (mis. `http://localhost:4000`; di prod sama origin lewat Nginx).
Path default Socket.IO: `/socket.io`.

### Client → Server

| Event | Payload | Keterangan |
|-------|---------|-----------|
| `join_room` | `{ code: string, nickname?: string }` | Gabung room. Server enforce max 3. |
| `send_message` | `{ content?: string, imageUrl?: string }` | Kirim pesan. Teks: `content` wajib. Gambar: `imageUrl` (dari endpoint upload) + `content` opsional sbg caption. |
| `typing` | `{ isTyping: boolean }` | (opsional) indikator mengetik. |
| `mark_read` | _(kosong)_ | Tandai sudah membaca sampai pesan terbaru (server set `lastReadAt=now`). |
| `leave_room` | _(kosong)_ | Keluar room secara eksplisit. |

### Server → Client

| Event | Payload | Keterangan |
|-------|---------|-----------|
| `joined` | `{ participantId: string; nickname: string; participants: Participant[]; messages: Message[] }` | Sukses join; kirim state awal. |
| `error` | `{ message: string }` | Gagal (mis. `"Room penuh"`, `"Room tidak ditemukan"`). |
| `message` | `Message` | Pesan baru broadcast ke semua anggota room. |
| `participant_joined` | `{ nickname: string; participants: Participant[] }` | Ada yang bergabung. |
| `participant_left` | `{ nickname: string; participants: Participant[] }` | Ada yang keluar/disconnect. |
| `read_receipt` | `{ participantId: string; nickname: string; lastReadAt: string }` | Seorang peserta baru membaca; FE update status "dibaca". |
| `typing` | `{ nickname: string; isTyping: boolean }` | (opsional) broadcast ke anggota lain. |

**Catatan flow:** FE boleh `POST /join` dulu untuk cek cepat (404/409), lalu emit `join_room`.
Enforcement final tetap di event socket `join_room` (source of truth untuk kursi peserta).

---

## 4. Data Model (PostgreSQL via Prisma)

Schema lengkap di [`be/prisma/schema.prisma`](be/prisma/schema.prisma).

**rooms**
| kolom | tipe | catatan |
|-------|------|---------|
| id | uuid (PK) | |
| code | text unik | shareable, 6 char |
| created_at | timestamptz | default now |

**participants**
| kolom | tipe | catatan |
|-------|------|---------|
| id | uuid (PK) | |
| room_id | uuid (FK→rooms) | |
| nickname | text | |
| socket_id | text nullable | socket aktif saat ini |
| joined_at | timestamptz | default now |
| is_active | boolean | true saat online; false saat leave/disconnect |
| last_read_at | timestamptz nullable | waktu terakhir peserta membaca (untuk read receipts) |

**Read receipts:** pesan `M` dianggap sudah dibaca peserta `P` bila `P.last_read_at >= M.created_at`.
FE menghitung pembaca per pesan dari daftar peserta (kecuali pengirim & diri sendiri).

Enforcement "max 3": `COUNT(participants WHERE room_id=? AND is_active=true) < 3`.

**messages**
| kolom | tipe | catatan |
|-------|------|---------|
| id | uuid (PK) | |
| room_id | uuid (FK→rooms) | |
| nickname | text | |
| content | text | teks/caption, sudah di-trim & di-sanitasi |
| type | text | `text` \| `image`, default `text` |
| image_url | text nullable | path gambar bila type=image |
| expires_at | timestamptz nullable | waktu kadaluarsa gambar (created_at + 24 jam) |
| created_at | timestamptz | default now |

**Auto-hapus gambar:** cleanup job BE hapus file di `uploads/` yang berumur >24 jam
(berdasarkan mtime) + hapus row pesan `type=image` yang `expires_at < now`. Disk tetap bersih.

---

## 5. Aturan Main untuk Perubahan

1. **Ubah kontrak = update `CLAUDE.md` dulu**, baru `be/` lalu `fe/`.
2. FE **tidak boleh** import Prisma / query DB langsung. Semua lewat REST/Socket BE.
3. Validasi & sanitasi input **wajib di BE** (nickname ≤24 char, pesan ≤1000 char, trim, buang karakter kontrol). Anti-XSS: FE **hanya** render konten sebagai teks (React auto-escape, **tanpa** `dangerouslySetInnerHTML`).
4. Enforcement max 3 orang **di BE** (event `join_room`), bukan cuma disable tombol di UI.
5. Nama event/field harus persis sama dengan tabel di atas — jangan bikin alias diam-diam.

---

## 6. Perintah Dev & Deploy (ringkas)

**Lokal (dua terminal):**
```bash
# Terminal 1 — Backend
cd be && cp .env.example .env      # sesuaikan DATABASE_URL
npm install
npx prisma migrate dev             # butuh Postgres jalan
npm run dev                        # http://localhost:4000

# Terminal 2 — Frontend
cd fe && cp .env.example .env.local
npm install
npm run dev                        # http://localhost:3000
```

**Docker (semua sekaligus):**
```bash
cp be/.env.example be/.env         # opsional; compose punya default
docker compose up -d --build       # fe:3000, be:4000, nginx:80
```

Detail deploy VPS + HTTPS ada di [`README.md`](README.md).
