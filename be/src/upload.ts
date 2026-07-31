import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { config, RULES } from "./config";

// Pastikan direktori upload ada.
fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    // nama file acak; ekstensi ditentukan server dari mimetype (jangan percaya nama klien)
    const ext = RULES.ALLOWED_IMAGE_MIME[file.mimetype] || "bin";
    cb(null, `${crypto.randomUUID()}.${ext}`);
  },
});

export const uploadImageMiddleware = multer({
  storage,
  limits: { fileSize: RULES.MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (RULES.ALLOWED_IMAGE_MIME[file.mimetype]) cb(null, true);
    else cb(new Error("INVALID_TYPE"));
  },
});

// Validasi imageUrl yang dikirim klien saat emit send_message:
// harus berpola /api/uploads/<file> dan filenya benar-benar ada di disk.
const URL_RE = /^\/api\/uploads\/([A-Za-z0-9_-]+\.(?:jpg|jpeg|png|gif|webp))$/;

export function resolveUploadedImage(imageUrl: unknown): string | null {
  if (typeof imageUrl !== "string") return null;
  const m = URL_RE.exec(imageUrl);
  if (!m) return null;
  const filename = m[1];
  // cegah path traversal (filename sudah dibatasi regex, tapi normalisasi lagi)
  const full = path.join(config.uploadDir, path.basename(filename));
  return fs.existsSync(full) ? imageUrl : null;
}
