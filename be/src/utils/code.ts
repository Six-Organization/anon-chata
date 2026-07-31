import { RULES } from "../config";

// Karakter tanpa yang ambigu (0/O, 1/I) supaya kode mudah dibagikan.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < RULES.ROOM_CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

// Normalisasi kode dari input user (uppercase, buang spasi).
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}
