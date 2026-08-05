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

// ---- Riwayat room yang pernah di-join (untuk shortcut di halaman home) ----
const RECENTS_KEY = "anonchat_recent_rooms";
const RECENTS_MAX = 8;

export type RecentRoom = { code: string; at: number };

export function getRecentRooms(): RecentRoom[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as RecentRoom[];
    return Array.isArray(list) ? list.filter((r) => r && r.code) : [];
  } catch {
    return [];
  }
}

export function addRecentRoom(code: string): void {
  if (typeof window === "undefined" || !code) return;
  const list = getRecentRooms().filter((r) => r.code !== code);
  list.unshift({ code, at: Date.now() });
  localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX)));
}

export function removeRecentRoom(code: string): void {
  if (typeof window === "undefined") return;
  const list = getRecentRooms().filter((r) => r.code !== code);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
}

// ---- Titip PIN sekali-pakai saat pindah room (decoy migration) ----
// Disimpan di sessionStorage & langsung dihapus setelah dibaca (tidak persisten).
const PIN_CARRY_PREFIX = "anonchat_pin_carry_";

export function carryPin(code: string, pin: string): void {
  if (typeof window === "undefined" || !pin) return;
  try {
    sessionStorage.setItem(PIN_CARRY_PREFIX + code, pin);
  } catch {
    /* ignore */
  }
}

export function takeCarriedPin(code: string): string {
  if (typeof window === "undefined") return "";
  try {
    const v = sessionStorage.getItem(PIN_CARRY_PREFIX + code) || "";
    if (v) sessionStorage.removeItem(PIN_CARRY_PREFIX + code);
    return v;
  } catch {
    return "";
  }
}

// ---- Tema (light/dark) ----
const THEME_KEY = "anonchat_theme";
export type Theme = "light" | "dark";

export function getTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function setTheme(theme: Theme): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}
