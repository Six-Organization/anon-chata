// Konfigurasi terpusat dari environment variables.
import path from "path";

export const config = {
  port: Number(process.env.PORT) || 4000,
  // CORS_ORIGIN bisa "*", satu origin, atau daftar dipisah koma.
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
  nodeEnv: process.env.NODE_ENV || "development",
  // Direktori penyimpanan gambar (di-mount sebagai volume Docker).
  uploadDir: process.env.UPLOAD_DIR || path.resolve(process.cwd(), "uploads"),
  // Email alert (SMTP). Kredensial HANYA dari env (repo public — jangan commit).
  mail: {
    host: process.env.MAIL_HOST || "",
    port: Number(process.env.MAIL_PORT) || 587,
    user: process.env.MAIL_USERNAME || "",
    pass: process.env.MAIL_PASSWORD || "",
    fromAddress:
      process.env.MAIL_FROM_ADDRESS || process.env.MAIL_USERNAME || "",
    fromName: process.env.MAIL_FROM_NAME || "Anon Chat",
    // tujuan notifikasi decoy (kode room baru)
    alertEmail: process.env.ALERT_EMAIL || "",
  },
};

// Batas aturan produk.
export const RULES = {
  MAX_PARTICIPANTS: 3,
  NICKNAME_MAX: 24,
  MESSAGE_MAX: 1000,
  ROOM_CODE_LENGTH: 6,
  MESSAGE_HISTORY_LIMIT: 200,
  // Media
  IMAGE_TTL_MS: 24 * 60 * 60 * 1000, // 24 jam (semua media)
  CLEANUP_INTERVAL_MS: 10 * 60 * 1000, // sapu tiap 10 menit
  // batas ukuran per jenis
  MAX_IMAGE_BYTES: 5 * 1024 * 1024, // 5 MB
  MAX_AUDIO_BYTES: 10 * 1024 * 1024, // 10 MB
  MAX_VIDEO_BYTES: 25 * 1024 * 1024, // 25 MB
  // mime yang diizinkan -> ekstensi file
  ALLOWED_IMAGE_MIME: {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  } as Record<string, string>,
  ALLOWED_AUDIO_MIME: {
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/aac": "aac",
  } as Record<string, string>,
  ALLOWED_VIDEO_MIME: {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  } as Record<string, string>,
} as const;

// Jenis media dari mimetype.
export type MediaKind = "image" | "audio" | "video";
export function kindFromMime(mime: string): MediaKind | null {
  if (RULES.ALLOWED_IMAGE_MIME[mime]) return "image";
  if (RULES.ALLOWED_AUDIO_MIME[mime]) return "audio";
  if (RULES.ALLOWED_VIDEO_MIME[mime]) return "video";
  return null;
}
export function extFromMime(mime: string): string {
  return (
    RULES.ALLOWED_IMAGE_MIME[mime] ||
    RULES.ALLOWED_AUDIO_MIME[mime] ||
    RULES.ALLOWED_VIDEO_MIME[mime] ||
    "bin"
  );
}
export function maxBytesForKind(kind: MediaKind): number {
  return kind === "image"
    ? RULES.MAX_IMAGE_BYTES
    : kind === "audio"
    ? RULES.MAX_AUDIO_BYTES
    : RULES.MAX_VIDEO_BYTES;
}

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
