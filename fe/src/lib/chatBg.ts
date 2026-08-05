import type { CSSProperties } from "react";

// Pola daun halus (nyambung tema hutan) sebagai SVG data-URI.
const leafSvg =
  "<svg xmlns='http://www.w3.org/2000/svg' width='84' height='84' viewBox='0 0 84 84'>" +
  "<g fill='none' stroke='rgb(148,163,184)' stroke-opacity='0.35' stroke-width='1.4'>" +
  "<path d='M14 58 Q14 30 40 24 Q34 50 14 58Z'/><path d='M16 56 Q28 42 40 24'/>" +
  "<path d='M56 78 Q56 54 80 48'/><path d='M70 20 Q52 22 50 42'/></g></svg>";
const leafUri = `url("data:image/svg+xml,${encodeURIComponent(leafSvg)}")`;

export type ChatBg = { id: string; label: string; style: CSSProperties };

// Semua preset dibuat semi-transparan agar warna dasar (light/dark) tetap tembus.
export const CHAT_BGS: ChatBg[] = [
  { id: "none", label: "Polos", style: {} },
  {
    id: "dots",
    label: "Titik",
    style: {
      backgroundImage:
        "radial-gradient(rgba(148,163,184,0.28) 1px, transparent 1px)",
      backgroundSize: "16px 16px",
    },
  },
  {
    id: "grid",
    label: "Grid",
    style: {
      backgroundImage:
        "linear-gradient(rgba(148,163,184,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.18) 1px, transparent 1px)",
      backgroundSize: "24px 24px",
    },
  },
  {
    id: "diagonal",
    label: "Garis",
    style: {
      backgroundImage:
        "repeating-linear-gradient(45deg, rgba(148,163,184,0.14) 0, rgba(148,163,184,0.14) 1px, transparent 1px, transparent 14px)",
    },
  },
  {
    id: "leaves",
    label: "Daun",
    style: { backgroundImage: leafUri, backgroundSize: "84px 84px" },
  },
  {
    id: "aurora",
    label: "Aurora",
    style: {
      backgroundImage:
        "radial-gradient(60% 40% at 10% 0%, rgba(99,102,241,0.12), transparent 70%), radial-gradient(60% 40% at 90% 100%, rgba(16,185,129,0.12), transparent 70%)",
    },
  },
];

// Wallpaper sekarang setelan ROOM (disimpan di server & dibagikan). Nilai =
// id preset di atas ATAU URL gambar (/api/uploads/wallpapers/...).
export function bgStyleOf(id: string): CSSProperties {
  return (CHAT_BGS.find((b) => b.id === id) || CHAT_BGS[0]).style;
}
export function isImageWallpaper(v: string | null | undefined): boolean {
  return typeof v === "string" && v.startsWith("/api/uploads/");
}

// Resize + kompres gambar jadi Blob JPEG kecil (sebelum di-upload ke server).
export function fileToResizedBlob(
  file: File,
  maxDim = 1600,
  quality = 0.78
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob gagal"))),
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("gagal baca gambar"));
    };
    img.src = url;
  });
}
