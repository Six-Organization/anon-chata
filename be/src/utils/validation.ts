import { RULES } from "../config";

// ---- Sanitasi input ----
// Anti-XSS ditegakkan berlapis:
//  1) FE HANYA me-render konten sebagai teks (React auto-escape, tidak pernah
//     dangerouslySetInnerHTML) — lihat /CLAUDE.md.
//  2) BE membuang karakter kontrol / null byte + membatasi panjang di sini.
// Kita TIDAK meng-HTML-escape saat menyimpan supaya karakter wajar seperti
// < > " ' tetap tampil apa adanya di UI (bukan &lt; / &#039;).
export function sanitizeText(input: string): string {
  // buang karakter kontrol C0 (kecuali \t \n) dan DEL
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

// Daftar nama random untuk user yang tidak mengisi nickname.
const RANDOM_NAMES = [
  "Anonim", "Rusa", "Panda", "Elang", "Serigala", "Koala",
  "Merpati", "Kucing", "Berang", "Musang", "Landak", "Kelinci",
];

export function randomNickname(): string {
  const name = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
  const num = Math.floor(100 + Math.random() * 900);
  return `${name}${num}`;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

// Nickname: trim, buang char kontrol, batasi panjang, kosong -> random.
export function normalizeNickname(raw: unknown): ValidationResult<string> {
  if (raw === undefined || raw === null) {
    return { ok: true, value: randomNickname() };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: "Nickname tidak valid" };
  }
  const cleaned = sanitizeText(raw).trim();
  if (cleaned.length === 0) {
    return { ok: true, value: randomNickname() };
  }
  if (cleaned.length > RULES.NICKNAME_MAX) {
    return {
      ok: false,
      error: `Nickname maksimal ${RULES.NICKNAME_MAX} karakter`,
    };
  }
  return { ok: true, value: cleaned };
}

// Caption gambar: opsional, boleh kosong, tetap dibatasi panjang & disanitasi.
export function normalizeCaption(raw: unknown): ValidationResult<string> {
  if (raw === undefined || raw === null) return { ok: true, value: "" };
  if (typeof raw !== "string") return { ok: false, error: "Caption tidak valid" };
  const cleaned = sanitizeText(raw).trim();
  if (cleaned.length > RULES.MESSAGE_MAX) {
    return { ok: false, error: `Caption maksimal ${RULES.MESSAGE_MAX} karakter` };
  }
  return { ok: true, value: cleaned };
}

// Isi pesan: wajib ada, trim, buang char kontrol, batasi panjang.
export function normalizeMessage(raw: unknown): ValidationResult<string> {
  if (typeof raw !== "string") {
    return { ok: false, error: "Pesan tidak valid" };
  }
  const cleaned = sanitizeText(raw).trim();
  if (cleaned.length === 0) {
    return { ok: false, error: "Pesan tidak boleh kosong" };
  }
  if (cleaned.length > RULES.MESSAGE_MAX) {
    return {
      ok: false,
      error: `Pesan maksimal ${RULES.MESSAGE_MAX} karakter`,
    };
  }
  return { ok: true, value: cleaned };
}
