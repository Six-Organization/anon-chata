// Konfigurasi terpusat dari environment variables.
import path from "path";

export const config = {
  port: Number(process.env.PORT) || 4000,
  // CORS_ORIGIN bisa "*", satu origin, atau daftar dipisah koma.
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
  nodeEnv: process.env.NODE_ENV || "development",
  // Direktori penyimpanan gambar (di-mount sebagai volume Docker).
  uploadDir: process.env.UPLOAD_DIR || path.resolve(process.cwd(), "uploads"),
};

// Batas aturan produk.
export const RULES = {
  MAX_PARTICIPANTS: 3,
  NICKNAME_MAX: 24,
  MESSAGE_MAX: 1000,
  ROOM_CODE_LENGTH: 6,
  MESSAGE_HISTORY_LIMIT: 200,
  // Gambar
  MAX_IMAGE_BYTES: 5 * 1024 * 1024, // 5 MB
  IMAGE_TTL_MS: 24 * 60 * 60 * 1000, // 24 jam
  CLEANUP_INTERVAL_MS: 10 * 60 * 1000, // sapu tiap 10 menit
  ALLOWED_IMAGE_MIME: {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  } as Record<string, string>,
} as const;

// URL publik gambar (path yang dilihat FE): /api/uploads/<file>
export const UPLOADS_URL_PREFIX = "/api/uploads";

function parseCorsOrigin(raw: string | undefined): string | string[] {
  if (!raw || raw.trim() === "" || raw.trim() === "*") return "*";
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length === 1 ? list[0] : list;
}
