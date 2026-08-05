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

const KEY = "anonchat_bg";

export function getChatBgId(): string {
  if (typeof window === "undefined") return "none";
  return localStorage.getItem(KEY) || "none";
}
export function setChatBgId(id: string): void {
  if (typeof window !== "undefined") localStorage.setItem(KEY, id);
}
export function bgStyleOf(id: string): CSSProperties {
  return (CHAT_BGS.find((b) => b.id === id) || CHAT_BGS[0]).style;
}
