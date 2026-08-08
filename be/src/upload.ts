import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { config, RULES, extFromMime, kindFromMime } from "./config";

// Pastikan direktori upload ada.
fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    // nama file acak; ekstensi ditentukan server dari mimetype (jangan percaya nama klien)
    cb(null, `${crypto.randomUUID()}.${extFromMime(file.mimetype)}`);
  },
});

export const uploadMediaMiddleware = multer({
  storage,
  // batas global = video (paling besar); batas per-jenis dicek lagi di route.
  limits: { fileSize: RULES.MAX_VIDEO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (kindFromMime(file.mimetype)) cb(null, true);
    else cb(new Error("INVALID_TYPE"));
  },
});

// ---- Wallpaper room (persisten; TIDAK kena auto-hapus 24 jam) ----
// Disimpan di subfolder uploads/wallpapers/ yang tak dipindai cleanup.
const wallpaperDir = path.join(config.uploadDir, "wallpapers");
fs.mkdirSync(wallpaperDir, { recursive: true });

const wallpaperStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, wallpaperDir),
  filename: (_req, file, cb) =>
    cb(null, `${crypto.randomUUID()}.${extFromMime(file.mimetype)}`),
});

export const uploadWallpaperMiddleware = multer({
  storage: wallpaperStorage,
  limits: { fileSize: 4 * 1024 * 1024, files: 1 }, // 4 MB (sudah di-resize klien)
  fileFilter: (_req, file, cb) => {
    if (RULES.ALLOWED_IMAGE_MIME[file.mimetype]) cb(null, true);
    else cb(new Error("INVALID_TYPE"));
  },
});

// ---- Stiker buatan sendiri (persisten di uploads/stickers/) ----
const stickerDir = path.join(config.uploadDir, "stickers");
fs.mkdirSync(stickerDir, { recursive: true });

const stickerStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, stickerDir),
  filename: (_req, file, cb) =>
    cb(null, `${crypto.randomUUID()}.${extFromMime(file.mimetype)}`),
});

export const uploadStickerMiddleware = multer({
  storage: stickerStorage,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }, // 2 MB (sudah di-resize klien)
  fileFilter: (_req, file, cb) => {
    if (RULES.ALLOWED_IMAGE_MIME[file.mimetype]) cb(null, true);
    else cb(new Error("INVALID_TYPE"));
  },
});

const STICKER_BUILTIN_RE = /^\/stickers\/[a-z0-9_-]+\.png$/;
const STICKER_UPLOAD_RE =
  /^\/api\/uploads\/stickers\/([A-Za-z0-9_-]+\.(?:png|webp|jpg|jpeg))$/;

// Validasi stiker yg dikirim: bawaan (/stickers/..) atau unggahan yg filenya ada.
export function resolveSticker(url: unknown): string | null {
  if (typeof url !== "string") return null;
  if (STICKER_BUILTIN_RE.test(url)) return url;
  const m = STICKER_UPLOAD_RE.exec(url);
  if (!m) return null;
  const full = path.join(stickerDir, path.basename(m[1]));
  return fs.existsSync(full) ? url : null;
}

const WALLPAPER_URL_RE =
  /^\/api\/uploads\/wallpapers\/([A-Za-z0-9_-]+\.(?:jpg|jpeg|png|gif|webp))$/;

export function resolveWallpaperUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = WALLPAPER_URL_RE.exec(url);
  if (!m) return null;
  const full = path.join(wallpaperDir, path.basename(m[1]));
  return fs.existsSync(full) ? url : null;
}

// Ekstensi media yang valid untuk validasi URL saat send_message.
const MEDIA_EXT = "jpg|jpeg|png|gif|webp|webm|m4a|mp3|ogg|aac|mp4|mov";
const URL_RE = new RegExp(`^/api/uploads/([A-Za-z0-9_-]+\\.(?:${MEDIA_EXT}))$`);

// Validasi imageUrl dari klien: harus /api/uploads/<file> & filenya ada.
export function resolveUploadedMedia(mediaUrl: unknown): string | null {
  if (typeof mediaUrl !== "string") return null;
  const m = URL_RE.exec(mediaUrl);
  if (!m) return null;
  const full = path.join(config.uploadDir, path.basename(m[1]));
  return fs.existsSync(full) ? mediaUrl : null;
}
