import fs from "fs";
import path from "path";
import { prisma } from "./prisma";
import { config, RULES } from "./config";

// Sapu gambar kadaluarsa:
//  1) hapus FILE di uploads/ yang berumur > 24 jam (berdasarkan mtime) — permanen.
//  2) hapus ROW pesan type=image yang expires_at < now — history bersih.
async function sweep(): Promise<void> {
  const now = Date.now();

  // 1) file lama
  try {
    const files = await fs.promises.readdir(config.uploadDir);
    let removed = 0;
    for (const f of files) {
      const fp = path.join(config.uploadDir, f);
      try {
        const st = await fs.promises.stat(fp);
        if (st.isFile() && now - st.mtimeMs > RULES.IMAGE_TTL_MS) {
          await fs.promises.unlink(fp);
          removed++;
        }
      } catch {
        /* file mungkin sudah hilang; abaikan */
      }
    }
    if (removed > 0) console.log(`[cleanup] hapus ${removed} file gambar kadaluarsa`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[cleanup] gagal baca uploadDir:", err);
    }
  }

  // 2) row pesan gambar kadaluarsa
  try {
    const res = await prisma.message.deleteMany({
      where: { type: "image", expiresAt: { lt: new Date() } },
    });
    if (res.count > 0) console.log(`[cleanup] hapus ${res.count} pesan gambar kadaluarsa`);
  } catch (err) {
    console.error("[cleanup] gagal hapus row:", err);
  }
}

export function startImageCleanup(): void {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  // jalankan sekali saat start, lalu berkala.
  void sweep();
  setInterval(() => void sweep(), RULES.CLEANUP_INTERVAL_MS);
  console.log(
    `[cleanup] aktif — gambar auto-hapus setelah ${RULES.IMAGE_TTL_MS / 3600000} jam`
  );
}
