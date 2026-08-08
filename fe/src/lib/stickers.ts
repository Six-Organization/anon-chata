export const BUILTIN_STICKERS = [
  "happy",
  "love",
  "laugh",
  "cool",
  "wink",
  "wow",
  "sad",
  "cry",
  "sleepy",
  "party",
  "heart",
];

export function stickerPath(id: string): string {
  return `/stickers/${id}.png`;
}

// ---- Stiker buatan sendiri (daftar disimpan lokal; gambarnya di server) ----
const MY_KEY = "anonchat_my_stickers";

export function getMyStickers(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MY_KEY);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export function addMySticker(url: string): void {
  if (typeof window === "undefined") return;
  const list = [url, ...getMyStickers().filter((u) => u !== url)].slice(0, 30);
  localStorage.setItem(MY_KEY, JSON.stringify(list));
}
export function removeMySticker(url: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    MY_KEY,
    JSON.stringify(getMyStickers().filter((u) => u !== url))
  );
}

// Ubah gambar jadi stiker: contain di kanvas persegi transparan, ekspor PNG.
export function fileToStickerBlob(file: File, size = 320): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      const scale = Math.min(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob gagal"))),
        "image/png"
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("gagal baca gambar"));
    };
    img.src = url;
  });
}
