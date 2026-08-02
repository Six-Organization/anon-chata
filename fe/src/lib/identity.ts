// Identitas & sesi tersimpan di localStorage (bertahan walau PWA ditutup).
// - clientId : identitas perangkat stabil → untuk menandai "bubble sendiri"
//              dan pakai-ulang kursi saat rejoin.
// - nickname : nama terakhir yang dipakai (dipertahankan lintas sesi).
// - session  : room terakhir + waktunya → auto-rejoin selama < 5 jam.

const CLIENT_KEY = "anonchat_client_id";
const NICK_KEY = "anonchat_nickname";
const SESSION_KEY = "anonchat_session";

export const SESSION_TTL_MS = 5 * 60 * 60 * 1000; // 5 jam

export function getClientId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

export function getSavedNickname(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(NICK_KEY) || "";
}

export function saveNickname(nick: string): void {
  if (typeof window === "undefined") return;
  if (nick && nick.trim()) localStorage.setItem(NICK_KEY, nick.trim());
}

export type Session = { code: string; at: number };

export function saveSession(code: string): void {
  if (typeof window === "undefined") return;
  const s: Session = { code, at: Date.now() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

// Kembalikan sesi aktif kalau belum lewat 5 jam; kalau kadaluarsa, dihapus.
export function getActiveSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s?.code || Date.now() - s.at > SESSION_TTL_MS) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
}
