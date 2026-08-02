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
