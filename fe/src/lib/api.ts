// Klien REST tipis ke backend. FE TIDAK akses DB langsung (lihat /CLAUDE.md).

import type { Participant, Message } from "./types";

// Origin server BE. Kosong = same-origin (via Nginx). FE menambah prefix /api sendiri.
const ORIGIN = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

// URL endpoint REST (selalu di bawah /api).
function apiUrl(path: string): string {
  return `${ORIGIN}/api${path}`;
}

// URL aset media (path sudah termasuk /api/uploads/...).
export function mediaUrl(path: string): string {
  return `${ORIGIN}${path}`;
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return (data?.error as string) || `Error ${res.status}`;
  } catch {
    return `Error ${res.status}`;
  }
}

export async function createRoom(): Promise<{ code: string }> {
  const res = await fetch(apiUrl("/rooms"), { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export type JoinResult = {
  code: string;
  participants: Participant[];
  nickname: string;
};

// Cek cepat sebelum konek socket. Melempar Error dengan pesan dari server
// (mis. "Room tidak ditemukan", "Room penuh").
export async function joinRoomCheck(
  code: string,
  nickname: string,
  clientId?: string
): Promise<JoinResult> {
  const res = await fetch(apiUrl(`/rooms/${encodeURIComponent(code)}/join`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, clientId }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function getMessages(code: string): Promise<Message[]> {
  const res = await fetch(apiUrl(`/rooms/${encodeURIComponent(code)}/messages`));
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  return data.messages as Message[];
}

export type MediaKind = "image" | "audio" | "video";

// Upload wallpaper room (persisten). Balikan { url }.
export async function uploadWallpaper(
  code: string,
  blob: Blob
): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", blob, "wallpaper.jpg");
  const res = await fetch(
    apiUrl(`/rooms/${encodeURIComponent(code)}/wallpaper`),
    { method: "POST", body: form }
  );
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

// Upload media dengan progress (XHR) — dipakai untuk kirim di background.
export function uploadMediaWithProgress(
  code: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<{ url: string; kind: MediaKind }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl(`/rooms/${encodeURIComponent(code)}/upload`));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Respons upload tidak valid"));
        }
      } else {
        let msg = `Error ${xhr.status}`;
        try {
          msg = JSON.parse(xhr.responseText).error || msg;
        } catch {
          /* keep default */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Gagal terhubung ke server"));
    xhr.send(form);
  });
}
